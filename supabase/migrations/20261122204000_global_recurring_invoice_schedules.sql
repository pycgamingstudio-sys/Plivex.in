-- Workspace-scoped recurring invoice schedules. Each run creates a reviewable draft only.
begin;
create table if not exists global.recurring_invoice_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  client_id uuid,
  currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),
  cadence text not null check(cadence in ('weekly','monthly','quarterly','yearly')),
  interval_count integer not null default 1 check(interval_count between 1 and 12),
  start_date date not null,
  next_run_date date not null,
  end_date date,
  payment_terms_days integer not null default 14 check(payment_terms_days between 0 and 365),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 100),
  tax_context jsonb not null check(jsonb_typeof(tax_context)='object'),
  notes text check(notes is null or length(notes)<=4000),
  status text not null default 'active' check(status in ('active','paused','completed')),
  last_generated_for date,
  last_generated_invoice_id uuid references global.invoices(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_date is null or end_date>=start_date)
);
create index if not exists global_recurring_invoice_due_idx
  on global.recurring_invoice_schedules(workspace_id,status,next_run_date);
alter table global.recurring_invoice_schedules enable row level security;
revoke all on global.recurring_invoice_schedules from public,anon,authenticated;
grant all on global.recurring_invoice_schedules to service_role;
drop policy if exists global_recurring_invoice_member_read on global.recurring_invoice_schedules;
create policy global_recurring_invoice_member_read on global.recurring_invoice_schedules
  for select to authenticated using(global.is_workspace_member(workspace_id));

create or replace function public.global_create_recurring_invoice_schedule(
  p_user_id uuid,p_workspace_id uuid,p_client_id uuid,p_currency_code text,p_cadence text,p_interval_count integer,
  p_start_date date,p_end_date date,p_payment_terms_days integer,p_items jsonb,p_tax_context jsonb,p_notes text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,global as $function$
declare v_role text; v_currency text; v_id uuid; v_item jsonb; v_quantity numeric; v_price bigint; v_discount bigint;
begin
  if p_user_id is null or p_workspace_id is null or p_currency_code is null or p_cadence is null or p_cadence not in ('weekly','monthly','quarterly','yearly')
    or p_interval_count is null or p_interval_count<1 or p_interval_count>12 or p_start_date is null or (p_end_date is not null and p_end_date<p_start_date)
    or p_payment_terms_days is null or p_payment_terms_days<0 or p_payment_terms_days>365 or p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 or p_tax_context is null
    or jsonb_typeof(p_tax_context)<>'object' or length(coalesce(p_notes,''))>4000 then
    return jsonb_build_object('ok',false,'reason','invalid_schedule');
  end if;
  select m.role,w.currency_code into v_role,v_currency from global.workspace_members m join global.workspaces w on w.id=m.workspace_id
    where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.status='active';
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager','employee') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if upper(p_currency_code)<>v_currency then return jsonb_build_object('ok',false,'reason','invalid_currency'); end if;
  if p_client_id is not null and not exists(select 1 from global.clients where id=p_client_id and workspace_id=p_workspace_id and status='active') then
    return jsonb_build_object('ok',false,'reason','client_not_found');
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_quantity:=(v_item->>'quantity')::numeric;
      v_price:=(v_item->>'unit_price_minor')::bigint;
      v_discount:=coalesce(nullif(v_item->>'discount_minor','')::bigint,0);
    exception when others then return jsonb_build_object('ok',false,'reason','invalid_items'); end;
    if length(btrim(coalesce(v_item->>'description','')))<1 or length(v_item->>'description')>500
      or v_quantity<=0 or v_quantity>1000000 or v_quantity*10000<>trunc(v_quantity*10000)
      or v_price<0 or v_price>9000000000000000 or v_discount<0 or v_discount>round(v_quantity*v_price) then
      return jsonb_build_object('ok',false,'reason','invalid_items');
    end if;
  end loop;
  insert into global.recurring_invoice_schedules(workspace_id,client_id,currency_code,cadence,interval_count,start_date,next_run_date,end_date,
    payment_terms_days,items,tax_context,notes,created_by)
  values(p_workspace_id,p_client_id,v_currency,p_cadence,p_interval_count,p_start_date,p_start_date,p_end_date,
    p_payment_terms_days,p_items,p_tax_context,nullif(btrim(p_notes),''),p_user_id)
  returning id into v_id;
  return jsonb_build_object('ok',true,'schedule_id',v_id);
end;
$function$;

create or replace function public.global_list_recurring_invoice_schedules(p_user_id uuid,p_workspace_id uuid,p_limit integer default 100)
returns jsonb language plpgsql security invoker stable set search_path=pg_catalog,global as $function$
declare v_role text; v_rows jsonb;
begin
  if p_user_id is null or p_workspace_id is null or p_limit<1 or p_limit>200 then
    raise exception using errcode='22023',message='Invalid recurring invoice list request';
  end if;
  select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active';
  if v_role is null then raise exception using errcode='42501',message='Workspace access denied'; end if;
  select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('generation_idempotency_key',
    (substr(md5(t.id::text||':'||t.next_run_date::text),1,8)||'-'||substr(md5(t.id::text||':'||t.next_run_date::text),9,4)||'-'||substr(md5(t.id::text||':'||t.next_run_date::text),13,4)||'-'||substr(md5(t.id::text||':'||t.next_run_date::text),17,4)||'-'||substr(md5(t.id::text||':'||t.next_run_date::text),21,12))::uuid
  ) order by t.next_run_date),'[]'::jsonb) into v_rows
  from (select * from global.recurring_invoice_schedules where workspace_id=p_workspace_id order by next_run_date limit p_limit) t;
  return jsonb_build_object('ok',true,'records',v_rows);
end;
$function$;

create or replace function public.global_advance_recurring_invoice_schedule(
  p_user_id uuid,p_workspace_id uuid,p_schedule_id uuid,p_run_date date,p_invoice_id uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,global as $function$
declare v_role text; v_schedule global.recurring_invoice_schedules%rowtype; v_next date; v_status text;
begin
  if p_user_id is null or p_workspace_id is null or p_schedule_id is null or p_run_date is null or p_invoice_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_schedule');
  end if;
  select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active';
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  select * into v_schedule from global.recurring_invoice_schedules where id=p_schedule_id and workspace_id=p_workspace_id for update;
  if v_schedule.id is null then return jsonb_build_object('ok',false,'reason','schedule_not_found'); end if;
  if v_schedule.last_generated_for=p_run_date then
    if v_schedule.last_generated_invoice_id<>p_invoice_id then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
    return jsonb_build_object('ok',true,'duplicate',true,'invoice_id',v_schedule.last_generated_invoice_id);
  end if;
  if v_schedule.status<>'active' or v_schedule.next_run_date<>p_run_date then return jsonb_build_object('ok',false,'reason','schedule_not_due'); end if;
  if not exists(select 1 from global.invoices where id=p_invoice_id and workspace_id=p_workspace_id and status='draft') then
    return jsonb_build_object('ok',false,'reason','invoice_not_found');
  end if;
  v_next:=case v_schedule.cadence
    when 'weekly' then v_schedule.next_run_date+(7*v_schedule.interval_count)
    when 'monthly' then (v_schedule.next_run_date+make_interval(months=>v_schedule.interval_count))::date
    when 'quarterly' then (v_schedule.next_run_date+make_interval(months=>3*v_schedule.interval_count))::date
    else (v_schedule.next_run_date+make_interval(years=>v_schedule.interval_count))::date
  end;
  v_status:=case when v_schedule.end_date is not null and v_next>v_schedule.end_date then 'completed' else 'active' end;
  update global.recurring_invoice_schedules set last_generated_for=p_run_date,last_generated_invoice_id=p_invoice_id,
    next_run_date=v_next,status=v_status,updated_at=now() where id=p_schedule_id and workspace_id=p_workspace_id;
  return jsonb_build_object('ok',true,'duplicate',false,'invoice_id',p_invoice_id,'next_run_date',v_next,'status',v_status);
end;
$function$;

create or replace function public.global_set_recurring_invoice_schedule_status(
  p_user_id uuid,p_workspace_id uuid,p_schedule_id uuid,p_status text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,global as $function$
declare v_role text; v_row global.recurring_invoice_schedules%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or p_schedule_id is null or p_status not in ('active','paused') then
    return jsonb_build_object('ok',false,'reason','invalid_schedule');
  end if;
  select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active';
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  update global.recurring_invoice_schedules set status=p_status,updated_at=now()
    where id=p_schedule_id and workspace_id=p_workspace_id and status in ('active','paused') returning * into v_row;
  if v_row.id is null then return jsonb_build_object('ok',false,'reason','schedule_not_found'); end if;
  return jsonb_build_object('ok',true,'record',to_jsonb(v_row));
end;
$function$;

revoke all on function public.global_create_recurring_invoice_schedule(uuid,uuid,uuid,text,text,integer,date,date,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.global_create_recurring_invoice_schedule(uuid,uuid,uuid,text,text,integer,date,date,integer,jsonb,jsonb,text) to service_role;
revoke all on function public.global_list_recurring_invoice_schedules(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.global_list_recurring_invoice_schedules(uuid,uuid,integer) to service_role;
revoke all on function public.global_advance_recurring_invoice_schedule(uuid,uuid,uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.global_advance_recurring_invoice_schedule(uuid,uuid,uuid,date,uuid) to service_role;
revoke all on function public.global_set_recurring_invoice_schedule_status(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.global_set_recurring_invoice_schedule_status(uuid,uuid,uuid,text) to service_role;
commit;
