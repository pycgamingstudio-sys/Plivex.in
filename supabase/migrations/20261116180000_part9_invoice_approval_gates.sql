-- Part 9: server-side approval gates for Global invoice issuance and payment recording.
-- Candidate migration only. It does not change the hosted database or India schema.
begin;

alter table global.approval_policies
  drop constraint if exists approval_policies_resource_type_check,
  drop constraint if exists approval_policies_action_type_check;
alter table global.approval_policies
  add constraint approval_policies_resource_type_check check (resource_type in ('expense','invoice')),
  add constraint approval_policies_action_type_check check (
    action_type in ('expense.create','expense.update','invoice.issue','invoice.payment.record')
  );

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
  v_resource_type text;
  v_policy global.approval_policies%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or p_action_type is null
    or p_action_type not in ('expense.create','expense.update','invoice.issue','invoice.payment.record')
    or p_enabled is null or p_minimum_amount_minor is null or p_minimum_amount_minor < 0
    or p_approver_roles is null or cardinality(p_approver_roles) < 1
    or not (p_approver_roles <@ array['owner','admin','manager','employee','accountant','viewer']::text[]) then
    return jsonb_build_object('ok',false,'code','INVALID_APPROVAL_POLICY');
  end if;
  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  if v_role not in ('owner','admin') then return jsonb_build_object('ok',false,'code','ADMIN_REQUIRED'); end if;

  v_resource_type := case when p_action_type like 'expense.%' then 'expense' else 'invoice' end;
  insert into global.approval_policies(workspace_id,resource_type,action_type,enabled,
    minimum_amount_minor,approver_roles,prevent_self_approval,created_by)
  values (p_workspace_id,v_resource_type,p_action_type,p_enabled,p_minimum_amount_minor,
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

create or replace function global.enforce_invoice_approval_gate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_action text;
  v_resource_id text;
  v_amount bigint;
  v_currency text;
  v_event_date date;
  v_requester uuid;
  v_policy global.approval_policies%rowtype;
  v_approval_id uuid;
begin
  if tg_table_name = 'invoices' then
    if tg_op <> 'UPDATE' or old.status = new.status or new.status <> 'issued' then
      return new;
    end if;
    v_action := 'invoice.issue';
    v_resource_id := new.id::text;
    v_amount := new.total_minor;
    v_currency := new.currency_code;
    v_event_date := new.issue_date;
    v_requester := new.created_by;
  elsif tg_table_name = 'invoice_payments' then
    v_action := 'invoice.payment.record';
    v_resource_id := new.invoice_id::text;
    v_amount := new.amount_minor;
    v_currency := new.currency_code;
    v_event_date := new.payment_date;
    v_requester := new.recorded_by;
  else
    raise exception 'unsupported_invoice_approval_table' using errcode='22023';
  end if;

  select * into v_policy
  from global.approval_policies
  where workspace_id = new.workspace_id
    and resource_type = 'invoice'
    and action_type = v_action
    and enabled
    and v_amount >= minimum_amount_minor
  for share;
  if v_policy.id is null then return new; end if;

  select ar.id into v_approval_id
  from global.approval_requests ar
  join global.workspace_members approver
    on approver.workspace_id = ar.workspace_id
   and approver.user_id = ar.approver_id
   and approver.status = 'active'
  where ar.workspace_id = new.workspace_id
    and ar.resource_type = 'invoice'
    and ar.action_type = v_action
    and ar.resource_id = v_resource_id
    and ar.status = 'approved'
    and ar.consumed_at is null
    and approver.role = any(v_policy.approver_roles)
    and (not v_policy.prevent_self_approval or ar.requester_id <> ar.approver_id)
    and ar.requester_id = v_requester
    and coalesce(ar.payload->>'amountMinor','') = v_amount::text
    and coalesce(ar.payload->>'currencyCode','') = v_currency
    and coalesce(ar.payload->>'eventDate','') = to_char(v_event_date,'YYYY-MM-DD')
  order by ar.created_at desc
  limit 1
  for update of ar;

  if v_approval_id is null then
    raise exception 'approval_required'
      using errcode='42501',
        detail=jsonb_build_object('actionType',v_action,'resourceType','invoice',
          'resourceId',v_resource_id,'minimumAmountMinor',v_policy.minimum_amount_minor)::text;
  end if;

  update global.approval_requests
    set consumed_at=now(),updated_at=now()
    where id=v_approval_id and consumed_at is null;
  if not found then raise exception 'approval_already_consumed' using errcode='42501'; end if;

  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values (new.workspace_id,v_requester,'approval.consumed','approval_request',v_approval_id::text,
    jsonb_build_object('resourceType','invoice','actionType',v_action,'resourceId',v_resource_id));
  return new;
end;
$function$;

drop trigger if exists global_invoice_issue_approval_gate on global.invoices;
create trigger global_invoice_issue_approval_gate
  before update of status on global.invoices
  for each row execute function global.enforce_invoice_approval_gate();

drop trigger if exists global_invoice_payment_approval_gate on global.invoice_payments;
create trigger global_invoice_payment_approval_gate
  before insert on global.invoice_payments
  for each row execute function global.enforce_invoice_approval_gate();

revoke all on function global.enforce_invoice_approval_gate() from public,anon,authenticated;
grant execute on function global.enforce_invoice_approval_gate() to service_role;

commit;
