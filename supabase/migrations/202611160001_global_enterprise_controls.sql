-- Part 7/8 additive Global financial provenance and enterprise controls.
-- Candidate migration only. It does not alter India public-schema objects.
begin;

create table if not exists global.tax_rule_versions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  jurisdiction_id text,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  tax_code text not null check (length(btrim(tax_code)) between 1 and 80),
  version text not null check (length(btrim(version)) between 1 and 40),
  treatment text not null check (treatment in ('standard','reduced','zero-rated','exempt','reverse-charge','out-of-scope')),
  effective_from date not null,
  effective_to date,
  reviewed_on date not null,
  reviewed_by text not null check (length(btrim(reviewed_by)) between 1 and 120),
  source_url text not null check (source_url ~ '^https://'),
  components jsonb not null check (jsonb_typeof(components) = 'array' and jsonb_array_length(components) between 1 and 8),
  status text not null default 'draft' check (status in ('draft','verified','retired')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (country_code, jurisdiction_id, tax_code, version)
);
create index if not exists global_tax_rule_resolution_idx
  on global.tax_rule_versions(country_code, jurisdiction_id, treatment, effective_from, effective_to)
  where status = 'verified';
create index if not exists global_tax_rule_created_by_idx on global.tax_rule_versions(created_by);

create table if not exists global.exchange_rate_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate_numerator numeric(38,0) not null check (rate_numerator > 0),
  rate_denominator numeric(38,0) not null check (rate_denominator > 0),
  source_url text not null check (source_url ~ '^https://'),
  provider text not null check (length(btrim(provider)) between 1 and 100),
  effective_at timestamptz not null,
  captured_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (base_currency <> quote_currency),
  check (effective_at <= captured_at)
);
create index if not exists global_fx_workspace_pair_time_idx
  on global.exchange_rate_snapshots(workspace_id, base_currency, quote_currency, captured_at desc);
create index if not exists global_fx_created_by_idx on global.exchange_rate_snapshots(created_by);

create table if not exists global.currency_conversion_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  snapshot_id uuid not null references global.exchange_rate_snapshots(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  base_amount_minor bigint not null,
  quote_amount_minor bigint not null,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rounding_mode text not null check (rounding_mode = 'half_up'),
  created_at timestamptz not null default now(),
  check (base_currency <> quote_currency)
);
create index if not exists global_currency_conversion_workspace_time_idx
  on global.currency_conversion_history(workspace_id, created_at desc);
create index if not exists global_currency_conversion_snapshot_idx
  on global.currency_conversion_history(snapshot_id);
create index if not exists global_currency_conversion_created_by_idx
  on global.currency_conversion_history(created_by);

create table if not exists global.workspace_branches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  branch_code text not null check (branch_code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check (length(btrim(name)) between 1 and 160),
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, branch_code),
  unique (workspace_id, id)
);
create index if not exists global_workspace_branches_workspace_status_idx
  on global.workspace_branches(workspace_id, status);
create index if not exists global_workspace_branches_created_by_idx on global.workspace_branches(created_by);

create table if not exists global.workspace_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  member_id uuid references global.workspace_members(id) on delete cascade,
  role text check (role in ('owner','admin','manager','employee','accountant','viewer')),
  permission_key text not null check (permission_key ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  effect text not null check (effect in ('grant','deny')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (member_id is not null or role is not null)
);
create unique index if not exists global_permission_member_unique_idx
  on global.workspace_permission_overrides(workspace_id, member_id, permission_key) where member_id is not null;
create unique index if not exists global_permission_role_unique_idx
  on global.workspace_permission_overrides(workspace_id, role, permission_key) where member_id is null;
create index if not exists global_permission_created_by_idx on global.workspace_permission_overrides(created_by);

create table if not exists global.approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  branch_id uuid,
  requester_id uuid not null references auth.users(id) on delete restrict,
  approver_id uuid references auth.users(id) on delete set null,
  action_type text not null check (action_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  resource_type text not null check (resource_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  resource_id text not null check (length(resource_id) between 1 and 160),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decision_note text check (decision_note is null or length(decision_note) <= 2000),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, branch_id) references global.workspace_branches(workspace_id, id) on delete set null (branch_id),
  check ((status = 'pending' and decided_at is null) or (status <> 'pending' and decided_at is not null))
);
create index if not exists global_approval_inbox_idx on global.approval_requests(workspace_id, status, created_at desc);
create index if not exists global_approval_requester_idx on global.approval_requests(requester_id, created_at desc);
create index if not exists global_approval_approver_idx on global.approval_requests(approver_id, status, created_at desc);

create table if not exists global.audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  branch_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  entity_id text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 32768),
  occurred_at timestamptz not null default now(),
  foreign key (workspace_id, branch_id) references global.workspace_branches(workspace_id, id) on delete set null (branch_id)
);
create index if not exists global_audit_workspace_time_idx on global.audit_events(workspace_id, occurred_at desc);
create index if not exists global_audit_actor_time_idx on global.audit_events(workspace_id, actor_id, occurred_at desc);

create table if not exists global.export_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  export_type text not null check (export_type in ('invoices','clients','products','expenses','audit_log','full_account')),
  format text not null check (format in ('csv','xlsx','json','pdf')),
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','expired')),
  storage_path text,
  file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text check (error_code is null or length(error_code) <= 80)
);
create index if not exists global_export_jobs_workspace_time_idx on global.export_jobs(workspace_id, created_at desc);
create index if not exists global_export_jobs_expiry_idx on global.export_jobs(expires_at) where status = 'completed';
create index if not exists global_export_jobs_requester_idx on global.export_jobs(requested_by, created_at desc);

create table if not exists global.workspace_retention_policies (
  workspace_id uuid primary key references global.workspaces(id) on delete cascade,
  audit_retention_days integer not null default 365 check (audit_retention_days between 30 and 3650),
  export_retention_days integer not null default 7 check (export_retention_days between 1 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists global.enterprise_rate_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{32}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);

alter table global.tax_rule_versions enable row level security;
alter table global.exchange_rate_snapshots enable row level security;
alter table global.currency_conversion_history enable row level security;
alter table global.workspace_branches enable row level security;
alter table global.workspace_permission_overrides enable row level security;
alter table global.approval_requests enable row level security;
alter table global.audit_events enable row level security;
alter table global.export_jobs enable row level security;
alter table global.workspace_retention_policies enable row level security;
alter table global.enterprise_rate_limits enable row level security;

create policy global_tax_rules_verified_read on global.tax_rule_versions
  for select to authenticated using (status = 'verified');
create policy global_fx_member_read on global.exchange_rate_snapshots
  for select to authenticated using (global.is_workspace_member(workspace_id));
create policy global_currency_conversion_member_read on global.currency_conversion_history
  for select to authenticated using (global.is_workspace_member(workspace_id));
create policy global_branches_member_read on global.workspace_branches
  for select to authenticated using (global.is_workspace_member(workspace_id));
create policy global_branches_admin_write on global.workspace_branches
  for all to authenticated using (global.is_workspace_admin(workspace_id))
  with check (global.is_workspace_admin(workspace_id));
create policy global_permissions_admin_read on global.workspace_permission_overrides
  for select to authenticated using (global.is_workspace_admin(workspace_id));
create policy global_approvals_member_read on global.approval_requests
  for select to authenticated using (global.is_workspace_member(workspace_id));
create policy global_audit_admin_read on global.audit_events
  for select to authenticated using (global.is_workspace_admin(workspace_id));
create policy global_exports_owner_read on global.export_jobs
  for select to authenticated using (requested_by = auth.uid() or global.is_workspace_admin(workspace_id));
create policy global_retention_admin_read on global.workspace_retention_policies
  for select to authenticated using (global.is_workspace_admin(workspace_id));
create policy global_rate_limit_service_only on global.enterprise_rate_limits
  for all to service_role using (true) with check (true);

create or replace function global.reject_immutable_row_mutation()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  raise exception 'immutable_record' using errcode = '55000';
end;
$$;
drop trigger if exists tax_rule_versions_immutable on global.tax_rule_versions;
create trigger tax_rule_versions_immutable before update or delete on global.tax_rule_versions
  for each row execute function global.reject_immutable_row_mutation();
drop trigger if exists exchange_rate_snapshots_immutable on global.exchange_rate_snapshots;
create trigger exchange_rate_snapshots_immutable before update or delete on global.exchange_rate_snapshots
  for each row execute function global.reject_immutable_row_mutation();
drop trigger if exists audit_events_immutable on global.audit_events;
create trigger audit_events_immutable before update on global.audit_events
  for each row execute function global.reject_immutable_row_mutation();

create or replace function public.global_consume_enterprise_rate_limit(
  p_key text, p_limit integer default 60, p_window_seconds integer default 60
) returns boolean
language plpgsql security definer set search_path = pg_catalog, global
as $$
declare v_count integer;
begin
  if p_key is null or length(p_key) < 1 or length(p_key) > 256
    or p_limit is null or p_limit < 1 or p_limit > 1000
    or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'invalid_rate_limit_arguments' using errcode = '22023';
  end if;
  insert into global.enterprise_rate_limits(key_hash, window_started_at, request_count)
  values (md5(p_key), now(), 1)
  on conflict (key_hash) do update set
    request_count = case
      when global.enterprise_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else global.enterprise_rate_limits.request_count + 1 end,
    window_started_at = case
      when global.enterprise_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else global.enterprise_rate_limits.window_started_at end,
    updated_at = now()
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.global_consume_enterprise_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.global_consume_enterprise_rate_limit(text, integer, integer) to service_role;

create or replace function public.global_enterprise_action(
  p_user_id uuid, p_workspace_id uuid, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, global
as $function$
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

  if p_action in ('branch.create','branch.archive','permission.set','retention.set','fx.snapshot.create') then
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
    if coalesce(p_payload->>'exportType','') not in ('invoices','clients','products','expenses','audit_log','full_account')
      or coalesce(p_payload->>'format','') not in ('csv','xlsx','json','pdf') then
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
revoke all on function public.global_enterprise_action(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.global_enterprise_action(uuid,uuid,text,jsonb) to service_role;

commit;
