-- Part 9: server-enforced approval gates for Global expense writes.
-- Additive candidate migration. No hosted database is changed by this file.
begin;

create table if not exists global.approval_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  resource_type text not null check (resource_type in ('expense')),
  action_type text not null check (action_type in ('expense.create','expense.update')),
  enabled boolean not null default true,
  minimum_amount_minor bigint not null default 0 check (minimum_amount_minor >= 0),
  approver_roles text[] not null default array['owner','admin','accountant']::text[],
  prevent_self_approval boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, resource_type, action_type),
  check (cardinality(approver_roles) > 0),
  check (approver_roles <@ array['owner','admin','manager','employee','accountant','viewer']::text[])
);

alter table global.approval_policies enable row level security;
alter table global.approval_requests add column if not exists consumed_at timestamptz;
drop policy if exists global_approval_policies_admin_read on global.approval_policies;
create policy global_approval_policies_admin_read on global.approval_policies
  for select to authenticated using (global.is_workspace_admin(workspace_id));
drop policy if exists global_approval_policies_admin_write on global.approval_policies;
create policy global_approval_policies_admin_write on global.approval_policies
  for all to authenticated using (global.is_workspace_admin(workspace_id))
  with check (global.is_workspace_admin(workspace_id));

grant select, insert, update, delete on global.approval_policies to authenticated;

create or replace function public.global_set_approval_policy(
  p_user_id uuid,
  p_workspace_id uuid,
  p_action_type text,
  p_enabled boolean,
  p_minimum_amount_minor bigint,
  p_approver_roles text[],
  p_prevent_self_approval boolean default true
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_policy global.approval_policies%rowtype;
begin
  if p_user_id is null or p_workspace_id is null
    or p_action_type not in ('expense.create','expense.update')
    or p_enabled is null or p_minimum_amount_minor is null or p_minimum_amount_minor < 0
    or p_approver_roles is null or cardinality(p_approver_roles) < 1
    or not (p_approver_roles <@ array['owner','admin','manager','employee','accountant','viewer']::text[]) then
    return jsonb_build_object('ok',false,'code','INVALID_APPROVAL_POLICY');
  end if;
  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  if v_role not in ('owner','admin') then return jsonb_build_object('ok',false,'code','ADMIN_REQUIRED'); end if;

  insert into global.approval_policies(workspace_id,resource_type,action_type,enabled,
    minimum_amount_minor,approver_roles,prevent_self_approval,created_by)
  values (p_workspace_id,'expense',p_action_type,p_enabled,p_minimum_amount_minor,
    p_approver_roles,coalesce(p_prevent_self_approval,true),p_user_id)
  on conflict (workspace_id,resource_type,action_type) do update set
    enabled=excluded.enabled,minimum_amount_minor=excluded.minimum_amount_minor,
    approver_roles=excluded.approver_roles,prevent_self_approval=excluded.prevent_self_approval,
    updated_at=now()
  returning * into v_policy;

  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values (p_workspace_id,p_user_id,'approval.policy.updated','approval_policy',v_policy.id::text,
    jsonb_build_object('actionType',p_action_type,'enabled',p_enabled,
      'minimumAmountMinor',p_minimum_amount_minor,'approverRoles',p_approver_roles));
  return jsonb_build_object('ok',true,'policy',to_jsonb(v_policy));
end;
$function$;
revoke all on function public.global_set_approval_policy(uuid,uuid,text,boolean,bigint,text[],boolean) from public, anon, authenticated;
grant execute on function public.global_set_approval_policy(uuid,uuid,text,boolean,bigint,text[],boolean) to service_role;

create index if not exists global_approval_policy_workspace_enabled_idx
  on global.approval_policies(workspace_id, resource_type, action_type) where enabled;
create index if not exists global_approval_request_resource_status_idx
  on global.approval_requests(workspace_id, resource_type, action_type, resource_id, status, created_at desc);

create or replace function global.enforce_expense_approval_gate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_action text;
  v_resource_id text;
  v_amount bigint;
  v_policy global.approval_policies%rowtype;
  v_approved boolean := false;
  v_approval_id uuid;
  v_requester_id uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'expense.create';
    v_resource_id := coalesce(new.creation_idempotency_key::text, new.id::text);
  else
    if new.amount_minor is not distinct from old.amount_minor
      and new.transaction_amount_minor is not distinct from old.transaction_amount_minor
      and new.currency_code is not distinct from old.currency_code
      and new.transaction_currency_code is not distinct from old.transaction_currency_code
      and new.category is not distinct from old.category
      and new.vendor is not distinct from old.vendor
      and new.expense_date is not distinct from old.expense_date
      and new.notes is not distinct from old.notes then
      return new;
    end if;
    v_action := 'expense.update';
    v_resource_id := new.id::text;
  end if;

  v_amount := coalesce(new.amount_minor, 0);
  select * into v_policy
  from global.approval_policies
  where workspace_id = new.workspace_id and resource_type = 'expense'
    and action_type = v_action and enabled and v_amount >= minimum_amount_minor
  for share;

  if v_policy.id is null then return new; end if;

  select ar.id, ar.requester_id into v_approval_id, v_requester_id
    from global.approval_requests ar
    join global.workspace_members approver
      on approver.workspace_id = ar.workspace_id
     and approver.user_id = ar.approver_id
     and approver.status = 'active'
    where ar.workspace_id = new.workspace_id
      and ar.resource_type = 'expense'
      and ar.action_type = v_action
      and ar.resource_id = v_resource_id
      and ar.status = 'approved'
      and ar.consumed_at is null
      and approver.role = any(v_policy.approver_roles)
      and (not v_policy.prevent_self_approval or ar.requester_id <> ar.approver_id)
      and coalesce(ar.payload->>'amountMinor','') = v_amount::text
      and coalesce(ar.payload->>'category','') = coalesce(new.category,'')
      and coalesce(ar.payload->>'vendor','') = coalesce(new.vendor,'')
      and coalesce(ar.payload->>'expenseDate','') = to_char(new.expense_date,'YYYY-MM-DD')
      and coalesce(ar.payload->>'currencyCode','') = coalesce(new.currency_code,'')
      and (tg_op <> 'INSERT' or ar.requester_id = new.created_by)
    order by ar.created_at desc
    limit 1
    for update of ar;
  v_approved := v_approval_id is not null;

  if not v_approved then
    raise exception 'approval_required'
      using errcode = '42501',
        detail = jsonb_build_object(
          'actionType', v_action,
          'resourceType', 'expense',
          'resourceId', v_resource_id,
          'minimumAmountMinor', v_policy.minimum_amount_minor
        )::text;
  end if;

  update global.approval_requests set consumed_at = now(), updated_at = now()
    where id = v_approval_id and consumed_at is null;
  if not found then
    raise exception 'approval_already_consumed' using errcode = '42501';
  end if;
  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values (new.workspace_id, v_requester_id, 'approval.consumed', 'approval_request', v_approval_id::text,
      jsonb_build_object('resourceType','expense','actionType',v_action,'resourceId',v_resource_id));
  return new;
end;
$function$;

drop trigger if exists global_expense_approval_gate on global.expenses;
create trigger global_expense_approval_gate
  before insert or update on global.expenses
  for each row execute function global.enforce_expense_approval_gate();

revoke all on function global.enforce_expense_approval_gate() from public, anon, authenticated;
grant execute on function global.enforce_expense_approval_gate() to service_role;

commit;
