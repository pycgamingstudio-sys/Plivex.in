-- Main Workspace monthly accounting close with serialized journal-period locking.
begin;

create table if not exists public.workspace_accounting_periods (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 period_start date not null,
 period_end date not null,
 status text not null default 'closed' check(status in ('closed','reopened')),
 posted_entry_count integer not null default 0 check(posted_entry_count>=0),
 debit_total numeric(20,4) not null default 0 check(debit_total>=0),
 credit_total numeric(20,4) not null default 0 check(credit_total>=0),
 close_notes text check(close_notes is null or length(close_notes)<=1000),
 closed_by uuid references auth.users(id) on delete restrict,
 closed_at timestamptz,
 reopened_by uuid references auth.users(id) on delete restrict,
 reopened_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,period_start),
 check(period_start=date_trunc('month',period_start)::date),
 check(period_end=(date_trunc('month',period_start)+interval '1 month - 1 day')::date),
 check(period_end>=period_start),
 check((status='closed' and closed_by is not null and closed_at is not null) or status='reopened')
);
create index if not exists workspace_accounting_periods_status_idx
 on public.workspace_accounting_periods(workspace_id,status,period_start desc);

alter table public.workspace_accounting_periods enable row level security;
revoke all on public.workspace_accounting_periods from public,anon,authenticated;
grant all on public.workspace_accounting_periods to service_role;

create or replace function public.guard_closed_accounting_period_journal()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare v_period_start date;
begin
 if new.entry_date is null or new.workspace_id is null then return new; end if;
 v_period_start:=date_trunc('month',new.entry_date)::date;
 -- Serializes journal creation/posting with close and reopen operations for this month.
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id||':'||to_char(v_period_start,'YYYY-MM'),0));
 if exists(
  select 1 from public.workspace_accounting_periods p
  where p.workspace_id=new.workspace_id and p.period_start=v_period_start and p.status='closed'
 ) then
  raise exception using errcode='55000',message='accounting_period_closed';
 end if;
 return new;
end;
$function$;
revoke all on function public.guard_closed_accounting_period_journal() from public,anon,authenticated;
drop trigger if exists journal_entries_closed_period_guard on public.journal_entries;
create trigger journal_entries_closed_period_guard
 before insert or update of entry_date,status on public.journal_entries
 for each row execute function public.guard_closed_accounting_period_journal();

create or replace function public.audit_accounting_period_change()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare v_actor uuid;v_action text;
begin
 v_actor:=case when tg_op='INSERT' then new.closed_by else coalesce(new.reopened_by,new.closed_by) end;
 if v_actor is null then raise exception using errcode='23502',message='Accounting period audit actor required'; end if;
 v_action:=case when tg_op='INSERT' then 'accounting.period.closed'
   when new.status='reopened' then 'accounting.period.reopened'
   else 'accounting.period.closed' end;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
 values(new.workspace_id,v_actor,v_action,'accounting_period',new.id::text,
  jsonb_build_object('period_start',new.period_start,'period_end',new.period_end,
   'status',new.status,'posted_entry_count',new.posted_entry_count,
   'debit_total',new.debit_total,'credit_total',new.credit_total));
 return new;
end;
$function$;
revoke all on function public.audit_accounting_period_change() from public,anon,authenticated;
drop trigger if exists workspace_accounting_period_audit on public.workspace_accounting_periods;
create trigger workspace_accounting_period_audit
 after insert or update on public.workspace_accounting_periods
 for each row execute function public.audit_accounting_period_change();

create or replace function public.main_workspace_list_accounting_periods(p_workspace_id text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare v_rows jsonb;
begin
 if auth.uid() is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then
  return jsonb_build_object('ok',false,'reason','forbidden');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'period_start',period_start,'period_end',period_end,'status',status,
  'posted_entry_count',posted_entry_count,'debit_total',debit_total,
  'credit_total',credit_total,'close_notes',close_notes,'closed_at',closed_at,
  'reopened_at',reopened_at
 ) order by period_start desc),'[]'::jsonb)
 into v_rows from public.workspace_accounting_periods where workspace_id=p_workspace_id;
 return jsonb_build_object('ok',true,'periods',v_rows);
end;
$function$;

create or replace function public.main_workspace_close_accounting_period(
 p_workspace_id text,p_period_start date,p_period_end date,p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
 v_user uuid:=auth.uid();v_start date;v_end date;
 v_drafts integer:=0;v_count integer:=0;v_debits numeric:=0;v_credits numeric:=0;
 v_existing public.workspace_accounting_periods%rowtype;v_id uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role]) then
  return jsonb_build_object('ok',false,'reason','admin_required');
 end if;
 if p_period_start is null or p_period_end is null or length(coalesce(p_notes,''))>1000 then
  return jsonb_build_object('ok',false,'reason','invalid_period');
 end if;
 v_start:=date_trunc('month',p_period_start)::date;
 v_end:=(date_trunc('month',p_period_start)+interval '1 month - 1 day')::date;
 if p_period_start<>v_start or p_period_end<>v_end then
  return jsonb_build_object('ok',false,'reason','period_must_be_full_calendar_month');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id||':'||to_char(v_start,'YYYY-MM'),0));
 select * into v_existing from public.workspace_accounting_periods
 where workspace_id=p_workspace_id and period_start=v_start for update;
 if found and v_existing.status='closed' then
  return jsonb_build_object('ok',true,'duplicate',true,'period_id',v_existing.id,'status','closed');
 end if;
 select count(*) into v_drafts from public.journal_entries
 where workspace_id=p_workspace_id and entry_date between v_start and v_end and status='draft';
 if v_drafts>0 then return jsonb_build_object('ok',false,'reason','unposted_journals_exist','draft_count',v_drafts); end if;
 select count(distinct j.id),coalesce(sum(l.debit),0),coalesce(sum(l.credit),0)
 into v_count,v_debits,v_credits
 from public.journal_entries j left join public.journal_entry_lines l
  on l.workspace_id=j.workspace_id and l.entry_id=j.id
 where j.workspace_id=p_workspace_id and j.entry_date between v_start and v_end and j.status='posted';
 if abs(v_debits-v_credits)>=0.0001 then
  return jsonb_build_object('ok',false,'reason','period_journal_totals_unbalanced');
 end if;
 if v_existing.id is null then
  insert into public.workspace_accounting_periods(
   workspace_id,period_start,period_end,status,posted_entry_count,debit_total,credit_total,
   close_notes,closed_by,closed_at
  ) values(p_workspace_id,v_start,v_end,'closed',v_count,v_debits,v_credits,nullif(btrim(p_notes),''),v_user,now())
  returning id into v_id;
 else
  update public.workspace_accounting_periods set status='closed',posted_entry_count=v_count,
   debit_total=v_debits,credit_total=v_credits,close_notes=nullif(btrim(p_notes),''),
   closed_by=v_user,closed_at=now(),reopened_by=null,reopened_at=null,updated_at=now()
  where id=v_existing.id returning id into v_id;
 end if;
 return jsonb_build_object('ok',true,'period_id',v_id,'status','closed',
  'period_start',v_start,'period_end',v_end,'posted_entry_count',v_count,
  'debit_total',v_debits,'credit_total',v_credits);
end;
$function$;

create or replace function public.main_workspace_reopen_accounting_period(
 p_workspace_id text,p_period_start date,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare v_user uuid:=auth.uid();v_id uuid;v_status text;v_start date;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role]) then
  return jsonb_build_object('ok',false,'reason','admin_required');
 end if;
 if p_period_start is null or length(btrim(coalesce(p_reason,'')))<5 or length(p_reason)>500 then
  return jsonb_build_object('ok',false,'reason','reopen_reason_required');
 end if;
 v_start:=date_trunc('month',p_period_start)::date;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id||':'||to_char(v_start,'YYYY-MM'),0));
 update public.workspace_accounting_periods set status='reopened',reopened_by=v_user,
  reopened_at=now(),close_notes=left('Reopened: '||btrim(p_reason),1000),updated_at=now()
 where workspace_id=p_workspace_id and period_start=v_start and status='closed'
 returning id,status into v_id,v_status;
 if v_id is null then return jsonb_build_object('ok',false,'reason','closed_period_not_found'); end if;
 return jsonb_build_object('ok',true,'period_id',v_id,'status',v_status,'period_start',v_start);
end;
$function$;

revoke all on function public.main_workspace_list_accounting_periods(text) from public,anon;
revoke all on function public.main_workspace_close_accounting_period(text,date,date,text) from public,anon;
revoke all on function public.main_workspace_reopen_accounting_period(text,date,text) from public,anon;
grant execute on function public.main_workspace_list_accounting_periods(text) to authenticated;
grant execute on function public.main_workspace_close_accounting_period(text,date,date,text) to authenticated;
grant execute on function public.main_workspace_reopen_accounting_period(text,date,text) to authenticated;


create or replace function public.guard_closed_accounting_period_journal_delete()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare v_period_start date;
begin
 v_period_start:=date_trunc('month',old.entry_date)::date;
 perform pg_advisory_xact_lock(hashtextextended(old.workspace_id||':'||to_char(v_period_start,'YYYY-MM'),0));
 if exists(select 1 from public.workspace_accounting_periods p
  where p.workspace_id=old.workspace_id and p.period_start=v_period_start and p.status='closed') then
  raise exception using errcode='55000',message='accounting_period_closed';
 end if;
 return old;
end;
$function$;
revoke all on function public.guard_closed_accounting_period_journal_delete() from public,anon,authenticated;
drop trigger if exists journal_entries_closed_period_delete_guard on public.journal_entries;
create trigger journal_entries_closed_period_delete_guard before delete on public.journal_entries
 for each row execute function public.guard_closed_accounting_period_journal_delete();

create or replace function public.guard_posted_main_workspace_journal_mutation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
begin
 if tg_table_name='journal_entries' then
  if old.status='posted' then
   raise exception using errcode='55000',message='Posted journal entries are immutable; create a correcting journal instead';
  end if;
 else
  if exists(select 1 from public.journal_entries j
   where j.workspace_id=old.workspace_id and j.id=old.entry_id and j.status='posted') then
   raise exception using errcode='55000',message='Posted journal lines are immutable; create a correcting journal instead';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$function$;
revoke all on function public.guard_posted_main_workspace_journal_mutation() from public,anon,authenticated;
drop trigger if exists journal_entries_posted_immutable on public.journal_entries;
create trigger journal_entries_posted_immutable before update or delete on public.journal_entries
 for each row execute function public.guard_posted_main_workspace_journal_mutation();
drop trigger if exists journal_entry_lines_posted_immutable on public.journal_entry_lines;
create trigger journal_entry_lines_posted_immutable before update or delete on public.journal_entry_lines
 for each row execute function public.guard_posted_main_workspace_journal_mutation();

commit;
