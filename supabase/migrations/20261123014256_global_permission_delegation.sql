-- Time-bound, auditable delegation of enterprise permissions to active workspace members.
begin;

create unique index if not exists global_workspace_members_workspace_id_id_uidx
  on global.workspace_members(workspace_id,id);

create table if not exists global.workspace_permission_delegations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  delegator_member_id uuid not null,
  delegate_member_id uuid not null,
  permission_keys text[] not null check (
    cardinality(permission_keys) between 1 and 9 and
    permission_keys <@ array[
      'approval.request','approval.decide','approval.read','audit.read',
      'export.request','fx.convert','branch.read','invoice.read','invoice.create'
    ]::text[]
  ),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','revoked')),
  created_by uuid not null references auth.users(id) on delete restrict,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (delegator_member_id<>delegate_member_id),
  check (expires_at>starts_at and expires_at<=starts_at+interval '90 days'),
  foreign key (workspace_id,delegator_member_id) references global.workspace_members(workspace_id,id) on delete cascade,
  foreign key (workspace_id,delegate_member_id) references global.workspace_members(workspace_id,id) on delete cascade
);
create index if not exists global_permission_delegations_delegate_idx
  on global.workspace_permission_delegations(workspace_id,delegate_member_id,expires_at desc);
create index if not exists global_permission_delegations_delegator_idx
  on global.workspace_permission_delegations(workspace_id,delegator_member_id,created_at desc);

alter table global.workspace_permission_delegations enable row level security;
revoke all on global.workspace_permission_delegations from public,anon,authenticated;
grant all on global.workspace_permission_delegations to service_role;

create or replace function global.has_active_permission_delegation(
  p_workspace_id uuid,p_member_id uuid,p_permission_key text
) returns boolean
language sql stable security definer set search_path=pg_catalog,global
as $$
  select exists(
    select 1 from global.workspace_permission_delegations d
    join global.workspace_members delegator
      on delegator.workspace_id=d.workspace_id and delegator.id=d.delegator_member_id
    where d.workspace_id=p_workspace_id and d.delegate_member_id=p_member_id
      and d.status='active' and d.starts_at<=now() and d.expires_at>now()
      and p_permission_key=any(d.permission_keys)
      and delegator.status='active' and delegator.role in ('owner','admin')
  );
$$;

create or replace function public.global_permission_delegation_create(
  p_user_id uuid,p_workspace_id uuid,p_delegate_member_id uuid,p_permission_keys text[],p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_actor global.workspace_members%rowtype; v_delegate global.workspace_members%rowtype; v_id uuid;
begin
  select * into v_actor from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_actor.id is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  if v_actor.role not in ('owner','admin') then return jsonb_build_object('ok',false,'code','ADMIN_REQUIRED'); end if;
  select * into v_delegate from global.workspace_members
    where workspace_id=p_workspace_id and id=p_delegate_member_id and status='active' limit 1;
  if v_delegate.id is null then return jsonb_build_object('ok',false,'code','MEMBER_NOT_FOUND'); end if;
  if v_delegate.id=v_actor.id then return jsonb_build_object('ok',false,'code','INVALID_DELEGATION'); end if;
  if p_permission_keys is null or cardinality(p_permission_keys)<1 or cardinality(p_permission_keys)>9
    or p_permission_keys <@ array[
      'approval.request','approval.decide','approval.read','audit.read',
      'export.request','fx.convert','branch.read','invoice.read','invoice.create'
    ]::text[]
    or cardinality(p_permission_keys)<>cardinality(array(select distinct unnest(p_permission_keys)))
    or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '90 days' then
    return jsonb_build_object('ok',false,'code','INVALID_DELEGATION');
  end if;
  if exists(
    select 1 from global.workspace_permission_overrides o
    where o.workspace_id=p_workspace_id and o.permission_key=any(p_permission_keys)
      and (o.member_id=v_delegate.id or (o.member_id is null and o.role=v_delegate.role))
  ) then
    return jsonb_build_object('ok',false,'code','PERMISSION_ALREADY_OVERRIDDEN');
  end if;
  insert into global.workspace_permission_delegations(
    workspace_id,delegator_member_id,delegate_member_id,permission_keys,starts_at,expires_at,created_by
  ) values(p_workspace_id,v_actor.id,v_delegate.id,p_permission_keys,now(),p_expires_at,p_user_id)
  returning id into v_id;
  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(p_workspace_id,p_user_id,'permission.delegation.created','permission_delegation',v_id::text,
    jsonb_build_object('delegate_member_id',v_delegate.id,'permission_keys',p_permission_keys,'expires_at',p_expires_at),now());
  return jsonb_build_object('ok',true,'delegationId',v_id);
end $$;

create or replace function public.global_permission_delegation_list(p_user_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_actor global.workspace_members%rowtype; v_can_manage boolean; v_delegations jsonb; v_members jsonb:='[]'::jsonb;
begin
  select * into v_actor from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_actor.id is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  v_can_manage:=v_actor.role in ('owner','admin');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'delegator_member_id',x.delegator_member_id,'delegate_member_id',x.delegate_member_id,
    'delegator_email',x.delegator_email,'delegate_email',x.delegate_email,
    'delegator_role',x.delegator_role,'delegate_role',x.delegate_role,
    'permission_keys',x.permission_keys,'starts_at',x.starts_at,'expires_at',x.expires_at,
    'status',case when x.status='active' and x.expires_at<=now() then 'expired' else x.status end,
    'created_at',x.created_at
  ) order by x.created_at desc),'[]'::jsonb) into v_delegations
  from (
    select d.*,du.email as delegator_email,eu.email as delegate_email,
      dm.role as delegator_role,em.role as delegate_role
    from global.workspace_permission_delegations d
    join global.workspace_members dm on dm.workspace_id=d.workspace_id and dm.id=d.delegator_member_id
    join global.workspace_members em on em.workspace_id=d.workspace_id and em.id=d.delegate_member_id
    left join auth.users du on du.id=dm.user_id
    left join auth.users eu on eu.id=em.user_id
    where d.workspace_id=p_workspace_id
      and (v_can_manage or d.delegator_member_id=v_actor.id or d.delegate_member_id=v_actor.id)
    order by d.created_at desc limit 200
  ) x;
  if v_can_manage then
    select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'email',u.email,'role',m.role) order by u.email),'[]'::jsonb)
      into v_members
    from global.workspace_members m
    left join auth.users u on u.id=m.user_id
    where m.workspace_id=p_workspace_id and m.status='active' and m.id<>v_actor.id and m.role not in ('owner','admin');
  end if;
  return jsonb_build_object('ok',true,'canManage',v_can_manage,'delegations',v_delegations,'members',v_members);
end $$;

create or replace function public.global_permission_delegation_revoke(
  p_user_id uuid,p_workspace_id uuid,p_delegation_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_actor global.workspace_members%rowtype; v_id uuid;
begin
  select * into v_actor from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_actor.id is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  if v_actor.role not in ('owner','admin') then return jsonb_build_object('ok',false,'code','ADMIN_REQUIRED'); end if;
  update global.workspace_permission_delegations set status='revoked',revoked_by=p_user_id,revoked_at=now()
    where workspace_id=p_workspace_id and id=p_delegation_id and status='active'
    returning id into v_id;
  if v_id is null then return jsonb_build_object('ok',false,'code','DELEGATION_NOT_FOUND'); end if;
  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(p_workspace_id,p_user_id,'permission.delegation.revoked','permission_delegation',v_id::text,'{}'::jsonb,now());
  return jsonb_build_object('ok',true,'delegationId',v_id,'status','revoked');
end $$;

CREATE OR REPLACE FUNCTION public.global_enterprise_action(p_user_id uuid, p_workspace_id uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'global'
AS $function$
declare
  v_member global.workspace_members%rowtype;
  v_admin boolean;
  v_allowed boolean := false;
  v_permission text;
  v_override text;
  v_id uuid;
  v_events jsonb;
  v_limit integer := 50;
  v_branch uuid;
  v_target_role text;
  v_snapshot global.exchange_rate_snapshots%rowtype;
  v_base_precision integer;
  v_quote_precision integer;
  v_amount numeric;
  v_numerator numeric;
  v_denominator numeric;
  v_converted numeric;
begin
  if p_user_id is null or p_workspace_id is null or p_action is null
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 32768 then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  select * into v_member from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_member.id is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  v_admin := v_member.role in ('owner','admin');

  if p_action in ('branch.create','branch.archive','permission.set','retention.set','fx.snapshot.create','health.read') then
    if not v_admin then return jsonb_build_object('ok',false,'code','ADMIN_REQUIRED'); end if;
  elsif p_action in ('branch.list','fx.convert','approval.request','approval.decide','approval.list','audit.list','export.request') then
    v_permission := case p_action
      when 'branch.list' then 'branch.read'
      when 'fx.convert' then 'fx.convert'
      when 'approval.request' then 'approval.request'
      when 'approval.decide' then 'approval.decide'
      when 'approval.list' then 'approval.read'
      when 'audit.list' then 'audit.read'
      when 'export.request' then 'export.request' end;
    select effect into v_override from global.workspace_permission_overrides
      where workspace_id=p_workspace_id and permission_key=v_permission
        and (member_id=v_member.id or (member_id is null and role=v_member.role))
      order by (member_id is not null) desc limit 1;
    if v_override is null and global.has_active_permission_delegation(p_workspace_id,v_member.id,v_permission) then
      v_override := 'grant';
    end if;
    if v_admin then
      v_allowed := true;
    elsif v_override = 'deny' then
      v_allowed := false;
    elsif v_override = 'grant' then
      v_allowed := true;
    else
      v_allowed := case v_member.role
        when 'manager' then v_permission in ('approval.request','approval.read','export.request','fx.convert','invoice.read','invoice.create')
        when 'employee' then v_permission in ('approval.request','invoice.read','invoice.create')
        when 'accountant' then v_permission in ('approval.request','approval.read','export.request','fx.convert','audit.read','invoice.read')
        when 'viewer' then v_permission in ('invoice.read','approval.read')
        else false end;
    end if;
    if not v_allowed then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED'); end if;
  else
    return jsonb_build_object('ok',false,'code','UNSUPPORTED_ACTION');
  end if;

  if p_action = 'fx.convert' then
    if coalesce(p_payload->>'snapshotId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'amountMinor','') !~ '^-?[0-9]{1,16}$' then
      return jsonb_build_object('ok',false,'code','INVALID_CONVERSION_INPUT');
    end if;
    v_amount := (p_payload->>'amountMinor')::numeric;
    if abs(v_amount) > 9007199254740991 then return jsonb_build_object('ok',false,'code','AMOUNT_OVERFLOW'); end if;
    select * into v_snapshot from global.exchange_rate_snapshots
      where id=(p_payload->>'snapshotId')::uuid and workspace_id=p_workspace_id;
    if v_snapshot.id is null then return jsonb_build_object('ok',false,'code','FX_SNAPSHOT_NOT_FOUND'); end if;
    v_base_precision := case v_snapshot.base_currency when 'JPY' then 0 when 'KRW' then 0 when 'KWD' then 3 when 'BHD' then 3 when 'OMR' then 3 when 'JOD' then 3 else 2 end;
    v_quote_precision := case v_snapshot.quote_currency when 'JPY' then 0 when 'KRW' then 0 when 'KWD' then 3 when 'BHD' then 3 when 'OMR' then 3 when 'JOD' then 3 else 2 end;
    v_numerator := abs(v_amount) * v_snapshot.rate_numerator * power(10::numeric,v_quote_precision);
    v_denominator := v_snapshot.rate_denominator * power(10::numeric,v_base_precision);
    v_converted := floor(v_numerator / v_denominator + 0.5);
    if v_amount < 0 then v_converted := -v_converted; end if;
    if abs(v_converted) > 9007199254740991 then return jsonb_build_object('ok',false,'code','AMOUNT_OVERFLOW'); end if;
    insert into global.currency_conversion_history(workspace_id,snapshot_id,created_by,base_amount_minor,
      quote_amount_minor,base_currency,quote_currency,rounding_mode)
    values (p_workspace_id,v_snapshot.id,p_user_id,v_amount::bigint,v_converted::bigint,
      v_snapshot.base_currency,v_snapshot.quote_currency,'half_up')
    returning id into v_id;
    insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values (p_workspace_id,p_user_id,'fx.converted','currency_conversion',v_id::text,
      jsonb_build_object('snapshotId',v_snapshot.id,'baseCurrency',v_snapshot.base_currency,'quoteCurrency',v_snapshot.quote_currency));
    return jsonb_build_object('ok',true,'conversionId',v_id,'baseAmountMinor',v_amount,
      'quoteAmountMinor',v_converted,'baseCurrency',v_snapshot.base_currency,'quoteCurrency',v_snapshot.quote_currency,
      'snapshotId',v_snapshot.id,'rounding','half_up');
  elsif p_action = 'fx.snapshot.create' then
    if coalesce(p_payload->>'baseCurrency','') not in ('INR','USD','EUR','GBP','AED','CAD','AUD','SGD','JPY','KRW','KWD','BHD','OMR','JOD')
      or coalesce(p_payload->>'quoteCurrency','') not in ('INR','USD','EUR','GBP','AED','CAD','AUD','SGD','JPY','KRW','KWD','BHD','OMR','JOD')
      or p_payload->>'baseCurrency' = p_payload->>'quoteCurrency'
      or coalesce(p_payload->>'rateNumerator','') !~ '^[1-9][0-9]{0,37}$'
      or coalesce(p_payload->>'rateDenominator','') !~ '^[1-9][0-9]{0,37}$'
      or coalesce(p_payload->>'sourceUrl','') !~ '^https://'
      or coalesce(p_payload->>'sourceUrl','') ~ '^https://[^/]*@'
      or length(btrim(coalesce(p_payload->>'provider',''))) not between 1 and 100 then
      return jsonb_build_object('ok',false,'code','INVALID_FX_SNAPSHOT');
    end if;
    if p_payload ? 'effectiveAt' and coalesce(p_payload->>'effectiveAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      return jsonb_build_object('ok',false,'code','INVALID_FX_TIMESTAMP');
    end if;
    if p_payload ? 'effectiveAt' and (p_payload->>'effectiveAt')::timestamptz > now() then
      return jsonb_build_object('ok',false,'code','FUTURE_FX_TIMESTAMP');
    end if;
    insert into global.exchange_rate_snapshots(workspace_id,base_currency,quote_currency,rate_numerator,rate_denominator,
      source_url,provider,effective_at,created_by)
    values (p_workspace_id,p_payload->>'baseCurrency',p_payload->>'quoteCurrency',
      (p_payload->>'rateNumerator')::numeric,(p_payload->>'rateDenominator')::numeric,
      p_payload->>'sourceUrl',btrim(p_payload->>'provider'),
      coalesce((p_payload->>'effectiveAt')::timestamptz,now()),p_user_id)
    returning id into v_id;
    insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values (p_workspace_id,p_user_id,'fx.snapshot_created','exchange_rate_snapshot',v_id::text,
      jsonb_build_object('baseCurrency',p_payload->>'baseCurrency','quoteCurrency',p_payload->>'quoteCurrency'));
    return jsonb_build_object('ok',true,'snapshotId',v_id);
  end if;
  if p_action = 'health.read' then
    select jsonb_build_object(
      'queuedExports',(select count(*) from global.export_jobs where workspace_id=p_workspace_id and status='queued'),
      'processingExports',(select count(*) from global.export_jobs where workspace_id=p_workspace_id and status='processing'),
      'failedExportsLast24h',(select count(*) from global.export_jobs where workspace_id=p_workspace_id and status='failed' and created_at >= now()-interval '24 hours'),
      'pendingApprovals',(select count(*) from global.approval_requests where workspace_id=p_workspace_id and status='pending'),
      'lastAuditAt',(select max(occurred_at) from global.audit_events where workspace_id=p_workspace_id),
      'lastFxSnapshotAt',(select max(captured_at) from global.exchange_rate_snapshots where workspace_id=p_workspace_id),
      'retentionConfigured',exists(select 1 from global.workspace_retention_policies where workspace_id=p_workspace_id)
    ) into v_events;
    return jsonb_build_object('ok',true,'health',v_events);
  elsif p_action = 'branch.list' then
    select coalesce(jsonb_agg(to_jsonb(b) order by b.name),'[]'::jsonb) into v_events
      from (select id,branch_code,name,address,status,created_at,updated_at
        from global.workspace_branches where workspace_id=p_workspace_id order by name limit 100) b;
    return jsonb_build_object('ok',true,'branches',coalesce(v_events,'[]'::jsonb));
  elsif p_action = 'branch.create' then
    if coalesce(p_payload->>'branchCode','') !~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'
      or length(btrim(coalesce(p_payload->>'name',''))) not between 1 and 160
      or (p_payload ? 'address' and jsonb_typeof(p_payload->'address') <> 'object') then
      return jsonb_build_object('ok',false,'code','INVALID_BRANCH');
    end if;
    insert into global.workspace_branches(workspace_id,branch_code,name,address,created_by)
    values (p_workspace_id,p_payload->>'branchCode',btrim(p_payload->>'name'),
      coalesce(p_payload->'address','{}'::jsonb),p_user_id)
    returning id into v_id;
    insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values (p_workspace_id,p_user_id,'branch.created','workspace_branch',v_id::text,
      jsonb_build_object('branchCode',p_payload->>'branchCode'));
    return jsonb_build_object('ok',true,'branchId',v_id);
  elsif p_action = 'branch.archive' then
    if coalesce(p_payload->>'branchId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok',false,'code','INVALID_BRANCH_ID');
    end if;
    update global.workspace_branches set status='archived',updated_at=now()
      where workspace_id=p_workspace_id and id=(p_payload->>'branchId')::uuid and status='active'
      returning id into v_id;
    if v_id is null then return jsonb_build_object('ok',false,'code','BRANCH_NOT_FOUND'); end if;
    insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id)
    values (p_workspace_id,p_user_id,'branch.archived','workspace_branch',v_id::text);
    return jsonb_build_object('ok',true,'branchId',v_id);
  elsif p_action = 'permission.set' then
    v_permission := p_payload->>'permissionKey';
    if coalesce(v_permission,'') !~ '^[a-z][a-z0-9_.-]{1,95}$'
      or coalesce(p_payload->>'effect','') not in ('grant','deny') then
      return jsonb_build_object('ok',false,'code','INVALID_PERMISSION');
    end if;
    if p_payload ? 'memberId' then
      if coalesce(p_payload->>'memberId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or not exists (select 1 from global.workspace_members
          where id=(p_payload->>'memberId')::uuid and workspace_id=p_workspace_id) then
        return jsonb_build_object('ok',false,'code','MEMBER_NOT_FOUND');
      end if;
      insert into global.workspace_permission_overrides(workspace_id,member_id,permission_key,effect,created_by)
      values (p_workspace_id,(p_payload->>'memberId')::uuid,v_permission,p_payload->>'effect',p_user_id)
      on conflict (workspace_id,member_id,permission_key) where member_id is not null
      do update set effect=excluded.effect,created_by=excluded.created_by,created_at=now()
      returning id into v_id;
    else
      v_target_role := p_payload->>'role';
      if coalesce(v_target_role,'') not in ('manager','employee','accountant','viewer') then
        return jsonb_build_object('ok',false,'code','INVALID_ROLE');
      end if;
      insert into global.workspace_permission_overrides(workspace_id,role,permission_key,effect,created_by)
      values (p_workspace_id,v_target_role,v_permission,p_payload->>'effect',p_user_id)
      on conflict (workspace_id,role,permission_key) where member_id is null
      do update set effect=excluded.effect,created_by=excluded.created_by,created_at=now()
      returning id into v_id;
    end if;
    insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values (p_workspace_id,p_user_id,'permission.override_set','workspace_permission',v_id::text,
      jsonb_build_object('permissionKey',v_permission,'effect',p_payload->>'effect'));
    return jsonb_build_object('ok',true,'overrideId',v_id);
  elsif p_action = 'approval.request' then
    if length(btrim(coalesce(p_payload->>'actionType',''))) not between 2 and 80
      or coalesce(p_payload->>'actionType','') !~ '^[a-z][a-z0-9_.-]{1,79}$'
      or length(btrim(coalesce(p_payload->>'resourceType',''))) not between 2 and 80
      or coalesce(p_payload->>'resourceType','') !~ '^[a-z][a-z0-9_.-]{1,79}$'
      or length(btrim(coalesce(p_payload->>'resourceId',''))) not between 1 and 160
      or (p_payload ? 'payload' and jsonb_typeof(p_payload->'payload') <> 'object') then
      return jsonb_build_object('ok',false,'code','INVALID_APPROVAL');
    end if;
    if p_payload ? 'branchId' and coalesce(p_payload->>'branchId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok',false,'code','INVALID_BRANCH_ID');
    end if;
    v_branch := case when p_payload ? 'branchId' then (p_payload->>'branchId')::uuid else null end;
    insert into global.approval_requests(workspace_id,branch_id,requester_id,action_type,resource_type,resource_id,payload)
    values (p_workspace_id,v_branch,p_user_id,p_payload->>'actionType',p_payload->>'resourceType',
      p_payload->>'resourceId',coalesce(p_payload->'payload','{}'::jsonb))
    returning id into v_id;
    insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values (p_workspace_id,p_user_id,'approval.requested','approval_request',v_id::text,
      jsonb_build_object('actionType',p_payload->>'actionType','resourceType',p_payload->>'resourceType'));
    return jsonb_build_object('ok',true,'requestId',v_id);
  elsif p_action = 'approval.decide' then
    if coalesce(p_payload->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'decision','') not in ('approved','rejected') then
      return jsonb_build_object('ok',false,'code','INVALID_DECISION');
    end if;
    update global.approval_requests set status=p_payload->>'decision',approver_id=p_user_id,
      decided_at=now(),decision_note=left(coalesce(p_payload->>'note',''),2000),updated_at=now()
      where id=(p_payload->>'requestId')::uuid and workspace_id=p_workspace_id
        and status='pending' and requester_id<>p_user_id and (approver_id is null or approver_id=p_user_id)
      returning id into v_id;
    if v_id is null then return jsonb_build_object('ok',false,'code','REQUEST_NOT_DECIDABLE'); end if;
    insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values (p_workspace_id,p_user_id,'approval.decided','approval_request',v_id::text,
      jsonb_build_object('decision',p_payload->>'decision'));
    return jsonb_build_object('ok',true,'requestId',v_id);
  elsif p_action = 'approval.list' then
    select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) into v_events
      from (select id,requester_id,approver_id,action_type,resource_type,resource_id,status,decision_note,decided_at,created_at
        from global.approval_requests where workspace_id=p_workspace_id and status='pending'
        order by created_at desc limit 100) a;
    return jsonb_build_object('ok',true,'requests',coalesce(v_events,'[]'::jsonb));
  elsif p_action = 'audit.list' then
    if coalesce(p_payload->>'limit','50') !~ '^[0-9]{1,3}$' then
      return jsonb_build_object('ok',false,'code','INVALID_LIMIT');
    end if;
    v_limit := greatest(1,least(coalesce((p_payload->>'limit')::integer,50),100));
    select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc),'[]'::jsonb) into v_events
      from (select id,actor_id,action,entity_type,entity_id,metadata,occurred_at
        from global.audit_events where workspace_id=p_workspace_id
        order by occurred_at desc limit v_limit) e;
    return jsonb_build_object('ok',true,'events',coalesce(v_events,'[]'::jsonb));
  elsif p_action = 'export.request' then
    if p_payload->>'exportType' = 'full_account' and not v_admin then
      return jsonb_build_object('ok',false,'code','ADMIN_REQUIRED');
    end if;
    if p_payload->>'exportType' = 'audit_log' and not (v_admin or v_member.role = 'accountant'
      or exists (select 1 from global.workspace_permission_overrides where workspace_id=p_workspace_id
        and member_id=v_member.id and permission_key='audit.read' and effect='grant')
      or global.has_active_permission_delegation(p_workspace_id,v_member.id,'audit.read')) then
      return jsonb_build_object('ok',false,'code','PERMISSION_DENIED');
    end if;
    if coalesce(p_payload->>'exportType','') not in ('invoices','clients','products','expenses','audit_log','full_account')
      or coalesce(p_payload->>'format','') not in ('csv','json') then
      return jsonb_build_object('ok',false,'code','INVALID_EXPORT');
    end if;
    insert into global.export_jobs(workspace_id,requested_by,export_type,format)
    values (p_workspace_id,p_user_id,p_payload->>'exportType',p_payload->>'format')
    returning id into v_id;
    insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values (p_workspace_id,p_user_id,'export.requested','export_job',v_id::text,
      jsonb_build_object('exportType',p_payload->>'exportType','format',p_payload->>'format'));
    return jsonb_build_object('ok',true,'jobId',v_id);
  elsif p_action = 'retention.set' then
    if coalesce(p_payload->>'auditRetentionDays','365') !~ '^[0-9]{1,4}$'
      or coalesce(p_payload->>'exportRetentionDays','7') !~ '^[0-9]{1,2}$'
      or coalesce((p_payload->>'auditRetentionDays')::integer,365) not between 30 and 3650
      or coalesce((p_payload->>'exportRetentionDays')::integer,7) not between 1 and 90 then
      return jsonb_build_object('ok',false,'code','INVALID_RETENTION');
    end if;
    insert into global.workspace_retention_policies(workspace_id,audit_retention_days,export_retention_days)
    values (p_workspace_id,coalesce((p_payload->>'auditRetentionDays')::integer,365),
      coalesce((p_payload->>'exportRetentionDays')::integer,7))
    on conflict (workspace_id) do update set
      audit_retention_days=excluded.audit_retention_days,
      export_retention_days=excluded.export_retention_days,updated_at=now();
    insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id)
    values (p_workspace_id,p_user_id,'retention.updated','workspace_retention_policy',p_workspace_id::text);
    return jsonb_build_object('ok',true);
  end if;
  return jsonb_build_object('ok',false,'code','UNSUPPORTED_ACTION');
end;
$function$;

CREATE OR REPLACE FUNCTION public.global_approval_request_v2(p_user_id uuid, p_workspace_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'global'
AS $function$
declare v_role text; v_member_id uuid; v_override text; v_request_id uuid; v_branch_id uuid;
  v_action text; v_resource text; v_resource_id text; v_payload jsonb; v_current integer; v_total integer;
begin
  if p_user_id is null or p_workspace_id is null or jsonb_typeof(p_payload)<>'object' then
    return jsonb_build_object('ok',false,'code','INVALID_REQUEST');
  end if;
  select id,role into v_member_id,v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  select effect into v_override from global.workspace_permission_overrides
    where workspace_id=p_workspace_id and permission_key='approval.request'
      and (member_id=v_member_id or (member_id is null and role=v_role))
    order by (member_id is not null) desc,created_at desc limit 1;
  if v_override is null and global.has_active_permission_delegation(p_workspace_id,v_member_id,'approval.request') then
    v_override := 'grant';
  end if;
  if v_role not in ('owner','admin') and (v_override='deny' or (v_override is distinct from 'grant' and v_role not in ('manager','employee','accountant'))) then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED');
  end if;
  v_action:=p_payload->>'actionType';
  v_resource:=p_payload->>'resourceType';
  v_resource_id:=nullif(btrim(p_payload->>'resourceId'),'');
  v_payload:=coalesce(p_payload->'payload','{}'::jsonb);
  if v_action not in ('expense.create','expense.update','invoice.issue','invoice.payment.record')
    or v_resource not in ('expense','invoice') or v_resource_id is null or length(v_resource_id)>200
    or jsonb_typeof(v_payload)<>'object' or length(v_payload::text)>20000 then
    return jsonb_build_object('ok',false,'code','INVALID_REQUEST');
  end if;
  if nullif(p_payload->>'branchId','') is not null then
    begin v_branch_id:=(p_payload->>'branchId')::uuid;
    exception when others then return jsonb_build_object('ok',false,'code','BRANCH_NOT_FOUND'); end;
    if not exists(select 1 from global.workspace_branches where workspace_id=p_workspace_id and id=v_branch_id) then
      return jsonb_build_object('ok',false,'code','BRANCH_NOT_FOUND');
    end if;
  end if;
  insert into global.approval_requests(workspace_id,branch_id,requester_id,action_type,resource_type,resource_id,payload,status)
  values(p_workspace_id,v_branch_id,p_user_id,v_action,v_resource,v_resource_id,v_payload,'pending')
  returning id into v_request_id;
  select current_level,total_levels into v_current,v_total from global.approval_requests where id=v_request_id;
  insert into global.audit_events(workspace_id,branch_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(p_workspace_id,v_branch_id,p_user_id,'approval.requested','approval_request',v_request_id::text,
    jsonb_build_object('action_type',v_action,'resource_type',v_resource,'current_level',v_current,'total_levels',v_total),now());
  return jsonb_build_object('ok',true,'requestId',v_request_id,'status','pending','currentLevel',v_current,'totalLevels',v_total);
end $function$;

CREATE OR REPLACE FUNCTION public.global_approval_decide_v2(p_user_id uuid, p_workspace_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'global'
AS $function$
declare v_role text; v_member_id uuid; v_override text; v_request global.approval_requests%rowtype;
  v_step global.approval_request_steps%rowtype; v_decision text; v_note text; v_next global.approval_request_steps%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or jsonb_typeof(p_payload)<>'object' then
    return jsonb_build_object('ok',false,'code','INVALID_REQUEST');
  end if;
  select id,role into v_member_id,v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  begin
    select * into v_request from global.approval_requests
      where workspace_id=p_workspace_id and id=(p_payload->>'requestId')::uuid for update;
  exception when others then return jsonb_build_object('ok',false,'code','REQUEST_NOT_FOUND'); end;
  if v_request.id is null then return jsonb_build_object('ok',false,'code','REQUEST_NOT_FOUND'); end if;
  if v_request.status<>'pending' then return jsonb_build_object('ok',false,'code','REQUEST_NOT_DECIDABLE'); end if;
  if v_request.requester_id=p_user_id then return jsonb_build_object('ok',false,'code','SELF_APPROVAL_BLOCKED'); end if;
  v_decision:=case when p_payload->>'decision' in ('approve','approved') then 'approved'
    when p_payload->>'decision' in ('reject','rejected') then 'rejected' else null end;
  v_note:=nullif(btrim(p_payload->>'note'),'');
  if v_decision is null or (v_note is not null and length(v_note)>2000) then
    return jsonb_build_object('ok',false,'code','INVALID_DECISION');
  end if;
  select * into v_step from global.approval_request_steps
    where workspace_id=p_workspace_id and request_id=v_request.id and level=v_request.current_level and status='pending'
    for update;
  if v_step.id is null then return jsonb_build_object('ok',false,'code','REQUEST_NOT_DECIDABLE'); end if;
  select effect into v_override from global.workspace_permission_overrides
    where workspace_id=p_workspace_id and permission_key='approval.decide'
      and (member_id=v_member_id or (member_id is null and role=v_role))
    order by (member_id is not null) desc,created_at desc limit 1;
  if v_override is null and global.has_active_permission_delegation(p_workspace_id,v_member_id,'approval.decide') then
    v_override := 'grant';
  end if;
  if v_role not in ('owner','admin') then
    if v_override='deny' then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED'); end if;
    if v_override is distinct from 'grant'
      and not (v_role=any(v_step.approver_roles) or (v_step.escalated_at is not null and v_role=v_step.escalation_role)) then
      return jsonb_build_object('ok',false,'code','APPROVER_ROLE_REQUIRED');
    end if;
  end if;
  update global.approval_request_steps set status=v_decision,approver_id=p_user_id,decision_note=v_note,
    decided_at=now(),updated_at=now() where id=v_step.id;
  if v_decision='rejected' then
    update global.approval_request_steps set status='skipped',updated_at=now()
      where workspace_id=p_workspace_id and request_id=v_request.id and status in ('waiting','pending') and id<>v_step.id;
    update global.approval_requests set status='rejected',approver_id=p_user_id,decision_note=v_note,decided_at=now(),updated_at=now()
      where id=v_request.id;
  else
    select * into v_next from global.approval_request_steps
      where workspace_id=p_workspace_id and request_id=v_request.id and status='waiting'
      order by level limit 1 for update;
    if v_next.id is not null then
      update global.approval_request_steps set status='pending',due_at=now()+make_interval(hours=>v_next.escalation_after_hours),updated_at=now()
        where id=v_next.id;
      update global.approval_requests set current_level=v_next.level,approver_id=p_user_id,updated_at=now()
        where id=v_request.id;
    else
      update global.approval_requests set status='approved',approver_id=p_user_id,decision_note=v_note,decided_at=now(),updated_at=now()
        where id=v_request.id;
    end if;
  end if;
  insert into global.audit_events(workspace_id,branch_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(p_workspace_id,v_request.branch_id,p_user_id,'approval.step.'||v_decision,'approval_step',v_step.id::text,
    jsonb_build_object('request_id',v_request.id,'level',v_step.level,'note',v_note),now());
  return jsonb_build_object('ok',true,'requestId',v_request.id,'decision',v_decision,
    'status',case when v_decision='rejected' then 'rejected' when v_next.id is not null then 'pending' else 'approved' end,
    'currentLevel',case when v_decision='rejected' then v_request.current_level when v_next.id is not null then v_next.level else v_request.total_levels end,
    'totalLevels',v_request.total_levels);
end $function$;

CREATE OR REPLACE FUNCTION public.global_approval_list_v2(p_user_id uuid, p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'global'
AS $function$
declare v_role text; v_member_id uuid; v_override text; v_rows jsonb;
begin
  select id,role into v_member_id,v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  select effect into v_override from global.workspace_permission_overrides
    where workspace_id=p_workspace_id and permission_key='approval.read'
      and (member_id=v_member_id or (member_id is null and role=v_role))
    order by (member_id is not null) desc,created_at desc limit 1;
  if v_override is null and global.has_active_permission_delegation(p_workspace_id,v_member_id,'approval.read') then
    v_override := 'grant';
  end if;
  if v_role not in ('owner','admin') and v_override='deny' then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED');
  end if;
  perform public.global_escalate_due_approvals();
  if v_role not in ('owner','admin','manager','accountant','viewer') and v_override is distinct from 'grant' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'requester_id',r.requester_id,'approver_id',r.approver_id,'action_type',r.action_type,
      'resource_type',r.resource_type,'resource_id',r.resource_id,'payload',r.payload,'status',r.status,
      'decision_note',r.decision_note,'created_at',r.created_at,'current_level',r.current_level,'total_levels',r.total_levels,
      'steps',(select coalesce(jsonb_agg(jsonb_build_object('level',s.level,'approver_roles',s.approver_roles,'status',s.status,
        'due_at',s.due_at,'escalated_at',s.escalated_at,'escalation_role',s.escalation_role,'approver_id',s.approver_id,
        'decision_note',s.decision_note) order by s.level),'[]'::jsonb)
        from global.approval_request_steps s where s.workspace_id=r.workspace_id and s.request_id=r.id)
    ) order by r.created_at desc),'[]'::jsonb) into v_rows
    from global.approval_requests r where r.workspace_id=p_workspace_id and r.requester_id=p_user_id and r.status='pending';
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'requester_id',r.requester_id,'approver_id',r.approver_id,'action_type',r.action_type,
      'resource_type',r.resource_type,'resource_id',r.resource_id,'payload',r.payload,'status',r.status,
      'decision_note',r.decision_note,'created_at',r.created_at,'current_level',r.current_level,'total_levels',r.total_levels,
      'steps',(select coalesce(jsonb_agg(jsonb_build_object('level',s.level,'approver_roles',s.approver_roles,'status',s.status,
        'due_at',s.due_at,'escalated_at',s.escalated_at,'escalation_role',s.escalation_role,'approver_id',s.approver_id,
        'decision_note',s.decision_note) order by s.level),'[]'::jsonb)
        from global.approval_request_steps s where s.workspace_id=r.workspace_id and s.request_id=r.id)
    ) order by r.created_at desc),'[]'::jsonb) into v_rows
    from global.approval_requests r where r.workspace_id=p_workspace_id and r.status='pending';
  end if;
  return jsonb_build_object('ok',true,'requests',v_rows);
end $function$;


revoke all on function global.has_active_permission_delegation(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.global_permission_delegation_create(uuid,uuid,uuid,text[],timestamptz) from public,anon,authenticated;
revoke all on function public.global_permission_delegation_list(uuid,uuid) from public,anon,authenticated;
revoke all on function public.global_permission_delegation_revoke(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function global.has_active_permission_delegation(uuid,uuid,text) to service_role;
grant execute on function public.global_permission_delegation_create(uuid,uuid,uuid,text[],timestamptz) to service_role;
grant execute on function public.global_permission_delegation_list(uuid,uuid) to service_role;
grant execute on function public.global_permission_delegation_revoke(uuid,uuid,uuid) to service_role;

revoke all on function public.global_enterprise_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.global_enterprise_action(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.global_approval_request_v2(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.global_approval_request_v2(uuid,uuid,jsonb) to service_role;
revoke all on function public.global_approval_decide_v2(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.global_approval_decide_v2(uuid,uuid,jsonb) to service_role;
revoke all on function public.global_approval_list_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.global_approval_list_v2(uuid,uuid) to service_role;

commit;
