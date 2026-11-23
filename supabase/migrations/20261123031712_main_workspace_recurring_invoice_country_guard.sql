-- Prevent recurring invoices from silently crossing Main Workspace country or currency changes.
begin;
alter table public.recurring_invoice_schedules add column if not exists source_country_code text, add column if not exists source_currency_code text;
update public.recurring_invoice_schedules s set source_country_code=w.country_code,source_currency_code=w.currency_code from public.workspace_settings w where w.workspace_id=s.workspace_id and s.source_country_code is null;
create or replace function public.main_workspace_create_recurring_invoice_schedule(p_workspace_id text,p_source_invoice_id uuid,p_frequency text,p_interval_count integer,p_next_run_on date,p_end_on date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_invoice public.invoices%rowtype; v_schedule public.recurring_invoice_schedules%rowtype; v_country text; v_currency text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_frequency not in ('daily','weekly','monthly','yearly') or p_interval_count not between 1 and 12 or p_next_run_on<current_date or (p_end_on is not null and p_end_on<p_next_run_on) then return jsonb_build_object('ok',false,'reason','invalid_schedule'); end if;
 select country_code,currency_code into v_country,v_currency from public.workspace_settings where workspace_id=p_workspace_id;
 if v_country is null or v_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('ok',false,'reason','workspace_country_currency_not_ready'); end if;
 select * into v_invoice from public.invoices where workspace_id=p_workspace_id and id=p_source_invoice_id for share;
 if not found or v_invoice.is_draft or lower(v_invoice.status) in ('draft','cancelled','void') then return jsonb_build_object('ok',false,'reason','source_invoice_not_issued'); end if;
 if v_invoice.currency<>v_currency then return jsonb_build_object('ok',false,'reason','source_invoice_currency_mismatch'); end if;
 insert into public.recurring_invoice_schedules(workspace_id,source_invoice_id,frequency,interval_count,next_run_on,end_on,created_by,source_country_code,source_currency_code)
 values(p_workspace_id,p_source_invoice_id,p_frequency,p_interval_count,p_next_run_on,p_end_on,v_user,v_country,v_currency) returning * into v_schedule;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_workspace_id,v_user,'recurring_invoice.schedule_created','recurring_invoice_schedule',v_schedule.id::text,jsonb_build_object('source_invoice_id',p_source_invoice_id,'frequency',p_frequency,'interval_count',p_interval_count,'country_code',v_country,'currency_code',v_currency));
 return jsonb_build_object('ok',true,'schedule_id',v_schedule.id);
end; $function$;

create or replace function public.main_workspace_generate_recurring_invoice_drafts()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_schedule public.recurring_invoice_schedules%rowtype; v_source public.invoices%rowtype; v_new_id uuid; v_number text; v_due date; v_next date; v_snapshot jsonb; v_count integer:=0; v_country text; v_currency text;
begin
 for v_schedule in select * from public.recurring_invoice_schedules where status='active' and next_run_on<=current_date order by next_run_on for update skip locked loop
  if v_schedule.end_on is not null and v_schedule.next_run_on>v_schedule.end_on then update public.recurring_invoice_schedules set status='completed',updated_at=now() where id=v_schedule.id; continue; end if;
  select country_code,currency_code into v_country,v_currency from public.workspace_settings where workspace_id=v_schedule.workspace_id;
  if v_country is distinct from v_schedule.source_country_code or v_currency is distinct from v_schedule.source_currency_code then
   update public.recurring_invoice_schedules set status='paused',updated_at=now() where id=v_schedule.id;
   insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(v_schedule.workspace_id,null,'recurring_invoice.schedule_paused_country_changed','recurring_invoice_schedule',v_schedule.id::text,jsonb_build_object('source_country_code',v_schedule.source_country_code,'current_country_code',v_country,'source_currency_code',v_schedule.source_currency_code,'current_currency_code',v_currency));
   continue;
  end if;
  if exists(select 1 from public.recurring_invoice_generations where schedule_id=v_schedule.id and occurrence_date=v_schedule.next_run_on) then
   v_next:=case v_schedule.frequency when 'daily' then v_schedule.next_run_on+v_schedule.interval_count when 'weekly' then v_schedule.next_run_on+(7*v_schedule.interval_count) when 'monthly' then (v_schedule.next_run_on+make_interval(months=>v_schedule.interval_count))::date else (v_schedule.next_run_on+make_interval(years=>v_schedule.interval_count))::date end;
   update public.recurring_invoice_schedules set next_run_on=v_next,status=case when end_on is not null and v_next>end_on then 'completed' else 'active' end,updated_at=now() where id=v_schedule.id; continue;
  end if;
  select * into v_source from public.invoices where workspace_id=v_schedule.workspace_id and id=v_schedule.source_invoice_id;
  if not found or v_source.currency<>v_schedule.source_currency_code then update public.recurring_invoice_schedules set status='paused',updated_at=now() where id=v_schedule.id; continue; end if;
  v_due:=case when v_source.due_date is null then null else v_schedule.next_run_on+greatest(0,v_source.due_date-v_source.issue_date) end;
  v_new_id:=gen_random_uuid(); v_number:=public.next_invoice_number(v_schedule.workspace_id);
  v_snapshot:=coalesce(v_source.invoice_snapshot,'{}'::jsonb)||jsonb_build_object('issueDate',v_schedule.next_run_on,'dueDate',v_due,'recurringSourceInvoiceId',v_source.id,'draftGeneratedAt',now(),'workspaceCountryCode',v_schedule.source_country_code);
  insert into public.invoices(id,workspace_id,created_by,number,client_name,client_email,business_name,issue_date,due_date,currency,tax_mode,tax_rate,discount_type,discount,notes,terms,status,is_draft,subtotal,tax_value,cgst,sgst,igst,total,stock_applied,client_id,invoice_snapshot)
  values(v_new_id,v_schedule.workspace_id,v_schedule.created_by,v_number,v_source.client_name,v_source.client_email,v_source.business_name,v_schedule.next_run_on,v_due,v_source.currency,v_source.tax_mode,v_source.tax_rate,v_source.discount_type,v_source.discount,v_source.notes,v_source.terms,'Draft',true,v_source.subtotal,v_source.tax_value,v_source.cgst,v_source.sgst,v_source.igst,v_source.total,false,v_source.client_id,v_snapshot);
  insert into public.invoice_items(invoice_id,description,quantity,rate,gst_rate) select v_new_id,description,quantity,rate,gst_rate from public.invoice_items where invoice_id=v_source.id;
  insert into public.recurring_invoice_generations(workspace_id,schedule_id,occurrence_date,generated_invoice_id) values(v_schedule.workspace_id,v_schedule.id,v_schedule.next_run_on,v_new_id);
  v_next:=case v_schedule.frequency when 'daily' then v_schedule.next_run_on+v_schedule.interval_count when 'weekly' then v_schedule.next_run_on+(7*v_schedule.interval_count) when 'monthly' then (v_schedule.next_run_on+make_interval(months=>v_schedule.interval_count))::date else (v_schedule.next_run_on+make_interval(years=>v_schedule.interval_count))::date end;
  update public.recurring_invoice_schedules set next_run_on=v_next,last_generated_at=now(),status=case when end_on is not null and v_next>end_on then 'completed' else 'active' end,updated_at=now() where id=v_schedule.id;
  insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(v_schedule.workspace_id,null,'recurring_invoice.draft_generated','invoice',v_new_id::text,jsonb_build_object('schedule_id',v_schedule.id,'source_invoice_id',v_source.id,'occurrence_date',v_schedule.next_run_on,'invoice_number',v_number,'country_code',v_schedule.source_country_code));
  v_count:=v_count+1;
 end loop;
 return v_count;
end; $function$;
commit;
