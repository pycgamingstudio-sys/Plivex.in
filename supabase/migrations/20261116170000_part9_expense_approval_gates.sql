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
drop policy if exists global_approval_policies_admin_read on global.approval_policies;
create policy global_approval_policies_admin_read on global.approval_policies
  for select to authenticated using (global.is_workspace_admin(workspace_id));
drop policy if exists global_approval_policies_admin_write on global.approval_policies;
create policy global_approval_policies_admin_write on global.approval_policies
  for all to authenticated using (global.is_workspace_admin(workspace_id))
  with check (global.is_workspace_admin(workspace_id));

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

  select exists (
    select 1
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
      and approver.role = any(v_policy.approver_roles)
      and (not v_policy.prevent_self_approval or ar.requester_id <> ar.approver_id)
      and coalesce(ar.payload->>'amountMinor','') = v_amount::text
      and coalesce(ar.payload->>'category','') = coalesce(new.category,'')
      and coalesce(ar.payload->>'vendor','') = coalesce(new.vendor,'')
      and coalesce(ar.payload->>'expenseDate','') = to_char(new.expense_date,'YYYY-MM-DD')
      and coalesce(ar.payload->>'currencyCode','') = coalesce(new.currency_code,'')
  ) into v_approved;

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
