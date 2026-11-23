-- Main Workspace recurring invoice schedules create future drafts, never auto-issue or auto-send them.
begin;
create table if not exists public.recurring_invoice_schedules (
 id uuid primary key default gen_random_uuid(), workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 source_invoice_id uuid not null references public.invoices(id) on delete restrict,
 frequency text not null check(frequency in ('daily','weekly','monthly','yearly')), interval_count integer not null default 1 check(interval_count between 1 and 12),
 next_run_on date not null, end_on date, status text not null default 'active' check(status in ('active','paused','completed','cancelled')),
 created_by uuid not null references auth.users(id) on delete restrict, last_generated_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(end_on is null or end_on>=next_run_on)
);
create table if not exists public.recurring_invoice_generations (
 id uuid primary key default gen_random_uuid(), workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 schedule_id uuid not null references public.recurring_invoice_schedules(id) on delete cascade,
 occurrence_date date not null, generated_invoice_id uuid not null references public.invoices(id) on delete restrict,
 created_at timestamptz not null default now(), unique(schedule_id,occurrence_date)
);
create index if not exists recurring_invoice_due_idx on public.recurring_invoice_schedules(status,next_run_on) where status='active';
create index if not exists recurring_invoice_workspace_idx on public.recurring_invoice_schedules(workspace_id,created_at desc);
alter table public.recurring_invoice_schedules enable row level security;
alter table public.recurring_invoice_generations enable row level security;
revoke all on public.recurring_invoice_schedules,public.recurring_invoice_generations from public,anon,authenticated;
grant all on public.recurring_invoice_schedules,public.recurring_invoice_generations to service_role;
create policy recurring_invoice_schedules_deny_client_access on public.recurring_invoice_schedules for all to anon,authenticated using(false) with check(false);
create policy recurring_invoice_generations_deny_client_access on public.recurring_invoice_generations for all to anon,authenticated using(false) with check(false);

create or replace function public.main_workspace_create_recurring_invoice_schedule(p_workspace_id text,p_source_invoice_id uuid,p_frequency text,p_interval_count integer,p_next_run_on date,p_end_on date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_invoice public.invoices%rowtype; v_schedule public.recurring_invoice_schedules%rowtype;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_frequency not in ('daily','weekly','monthly','yearly') or p_interval_count not between 1 and 12 or p_next_run_on<current_date or (p_end_on is not null and p_end_on<p_next_run_on) then return jsonb_build_object('ok',false,'reason','invalid_schedule'); end if;
 select * into v_invoice from public.invoices where workspace_id=p_workspace_id and id=p_source_invoice_id for share;
 if not found or v_invoice.is_draft or lower(v_invoice.status) in ('draft','cancelled','void') then return jsonb_build_object('ok',false,'reason','source_invoice_not_issued'); end if;
 insert into public.recurring_invoice_schedules(workspace_id,source_invoice_id,frequency,interval_count,next_run_on,end_on,created_by)
 values(p_workspace_id,p_source_invoice_id,p_frequency,p_interval_count,p_next_run_on,p_end_on,v_user) returning * into v_schedule;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_workspace_id,v_user,'recurring_invoice.schedule_created','recurring_invoice_schedule',v_schedule.id::text,jsonb_build_object('source_invoice_id',p_source_invoice_id,'frequency',p_frequency,'interval_count',p_interval_count));
 return jsonb_build_object('ok',true,'schedule_id',v_schedule.id);
end; $function$;

create or replace function public.main_workspace_generate_recurring_invoice_drafts()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_schedule public.recurring_invoice_schedules%rowtype; v_source public.invoices%rowtype; v_new_id uuid; v_number text; v_due date; v_next date; v_snapshot jsonb; v_count integer:=0;
begin
 for v_schedule in select * from public.recurring_invoice_schedules where status='active' and next_run_on<=current_date order by next_run_on for update skip locked loop
  if v_schedule.end_on is not null and v_schedule.next_run_on>v_schedule.end_on then update public.recurring_invoice_schedules set status='completed',updated_at=now() where id=v_schedule.id; continue; end if;
  if exists(select 1 from public.recurring_invoice_generations where schedule_id=v_schedule.id and occurrence_date=v_schedule.next_run_on) then
   v_next:=case v_schedule.frequency when 'daily' then v_schedule.next_run_on+v_schedule.interval_count when 'weekly' then v_schedule.next_run_on+(7*v_schedule.interval_count) when 'monthly' then (v_schedule.next_run_on+make_interval(months=>v_schedule.interval_count))::date else (v_schedule.next_run_on+make_interval(years=>v_schedule.interval_count))::date end;
   update public.recurring_invoice_schedules set next_run_on=v_next,status=case when end_on is not null and v_next>end_on then 'completed' else 'active' end,updated_at=now() where id=v_schedule.id; continue;
  end if;
  select * into v_source from public.invoices where workspace_id=v_schedule.workspace_id and id=v_schedule.source_invoice_id;
  if not found then update public.recurring_invoice_schedules set status='paused',updated_at=now() where id=v_schedule.id; continue; end if;
  v_due:=case when v_source.due_date is null then null else v_schedule.next_run_on+greatest(0,v_source.due_date-v_source.issue_date) end;
  v_new_id:=gen_random_uuid(); v_number:=public.next_invoice_number(v_schedule.workspace_id);
  v_snapshot:=coalesce(v_source.invoice_snapshot,'{}'::jsonb)||jsonb_build_object('issueDate',v_schedule.next_run_on,'dueDate',v_due,'recurringSourceInvoiceId',v_source.id,'draftGeneratedAt',now());
  insert into public.invoices(id,workspace_id,created_by,number,client_name,client_email,business_name,issue_date,due_date,currency,tax_mode,tax_rate,discount_type,discount,notes,terms,status,is_draft,subtotal,tax_value,cgst,sgst,igst,total,stock_applied,client_id,invoice_snapshot)
  values(v_new_id,v_schedule.workspace_id,v_schedule.created_by,v_number,v_source.client_name,v_source.client_email,v_source.business_name,v_schedule.next_run_on,v_due,v_source.currency,v_source.tax_mode,v_source.tax_rate,v_source.discount_type,v_source.discount,v_source.notes,v_source.terms,'Draft',true,v_source.subtotal,v_source.tax_value,v_source.cgst,v_source.sgst,v_source.igst,v_source.total,false,v_source.client_id,v_snapshot);
  insert into public.invoice_items(invoice_id,description,quantity,rate,gst_rate) select v_new_id,description,quantity,rate,gst_rate from public.invoice_items where invoice_id=v_source.id;
  insert into public.recurring_invoice_generations(workspace_id,schedule_id,occurrence_date,generated_invoice_id) values(v_schedule.workspace_id,v_schedule.id,v_schedule.next_run_on,v_new_id);
  v_next:=case v_schedule.frequency when 'daily' then v_schedule.next_run_on+v_schedule.interval_count when 'weekly' then v_schedule.next_run_on+(7*v_schedule.interval_count) when 'monthly' then (v_schedule.next_run_on+make_interval(months=>v_schedule.interval_count))::date else (v_schedule.next_run_on+make_interval(years=>v_schedule.interval_count))::date end;
  update public.recurring_invoice_schedules set next_run_on=v_next,last_generated_at=now(),status=case when end_on is not null and v_next>end_on then 'completed' else 'active' end,updated_at=now() where id=v_schedule.id;
  insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_schedule.workspace_id,null,'recurring_invoice.draft_generated','invoice',v_new_id::text,jsonb_build_object('schedule_id',v_schedule.id,'source_invoice_id',v_source.id,'occurrence_date',v_schedule.next_run_on,'invoice_number',v_number));
  v_count:=v_count+1;
 end loop;
 return v_count;
end; $function$;
revoke all on function public.main_workspace_create_recurring_invoice_schedule(text,uuid,text,integer,date,date) from public,anon;
grant execute on function public.main_workspace_create_recurring_invoice_schedule(text,uuid,text,integer,date,date) to authenticated;
revoke all on function public.main_workspace_generate_recurring_invoice_drafts() from public,anon,authenticated;
grant execute on function public.main_workspace_generate_recurring_invoice_drafts() to service_role;
do $$ begin
 if exists(select 1 from cron.job where jobname='main-workspace-recurring-invoice-drafts') then perform cron.unschedule((select jobid from cron.job where jobname='main-workspace-recurring-invoice-drafts' limit 1)); end if;
 perform cron.schedule('main-workspace-recurring-invoice-drafts','15 * * * *','select public.main_workspace_generate_recurring_invoice_drafts();');
end $$;
commit;
