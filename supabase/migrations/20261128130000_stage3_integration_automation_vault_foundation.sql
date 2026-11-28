-- Stage 3 foundations: integration registry, signed webhook outbox, deterministic automations and document vault metadata.
-- All new data is Main Workspace scoped. Secrets remain encrypted/server-side; client roles receive no table access.
begin;

create table if not exists public.workspace_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  provider_key text not null check (provider_key in ('shopify','whatsapp_cloud','cashfree','paddle','public_api','custom_webhooks')),
  status text not null default 'setup_required' check (status in ('available','setup_required','awaiting_provider_access','sandbox_tested','live_verified')),
  account_label text,
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata) = 'object'),
  last_checked_at timestamptz,
  verified_at timestamptz,
  last_error_code text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider_key),
  check (status <> 'live_verified' or verified_at is not null)
);
create index if not exists workspace_integrations_workspace_idx
  on public.workspace_integrations(workspace_id, status, provider_key);

create table if not exists public.workspace_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  provider_key text not null check (provider_key in ('shopify','custom')),
  label text not null check (length(btrim(label)) between 2 and 100),
  secret_name text not null unique check (secret_name ~ '^plivex_webhook_[a-f0-9-]{36}$'),
  event_types text[] not null check (
    cardinality(event_types) between 1 and 8
    and event_types <@ array[
      'orders/create','orders/updated','products/create','products/update','inventory_levels/update',
      'invoice.created','invoice.status_changed','lead.created','lead.stage_changed','expense.created','stock.low_stock'
    ]::text[]
  ),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index if not exists workspace_webhook_subscriptions_active_idx
  on public.workspace_webhook_subscriptions(workspace_id, is_active, created_at desc);

create table if not exists public.workspace_webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  subscription_id uuid not null,
  provider_key text not null check (provider_key in ('shopify','custom')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  event_type text not null check (length(event_type) between 1 and 120),
  event_timestamp timestamptz,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 262144),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  signature_verified boolean not null default true check (signature_verified = true),
  status text not null default 'pending' check (status in ('pending','processing','processed','retrying','dead_letter')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 12),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (workspace_id, subscription_id)
    references public.workspace_webhook_subscriptions(workspace_id, id) on delete cascade,
  unique (subscription_id, provider_event_id)
);
create index if not exists workspace_webhook_events_retry_idx
  on public.workspace_webhook_events(next_attempt_at, received_at)
  where status in ('pending','retrying');
create index if not exists workspace_webhook_events_workspace_idx
  on public.workspace_webhook_events(workspace_id, received_at desc);

create table if not exists public.workspace_webhook_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  event_id uuid not null references public.workspace_webhook_events(id) on delete cascade,
  attempt_no integer not null check (attempt_no between 0 and 12),
  status text not null check (status in ('accepted','processed','retrying','dead_letter','duplicate','rejected')),
  error_code text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);
create index if not exists workspace_webhook_attempts_event_idx
  on public.workspace_webhook_attempts(workspace_id, event_id, occurred_at desc);

create table if not exists public.workspace_event_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  event_type text not null check (event_type in ('invoice.created','invoice.status_changed','lead.created','lead.stage_changed','expense.created','stock.low_stock','integration.webhook_received')),
  entity_type text not null check (entity_type in ('invoice','lead','expense','stock_item','integration_webhook')),
  entity_id text not null,
  dedupe_key text not null unique default gen_random_uuid()::text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error_code text,
  created_at timestamptz not null default now()
);
create index if not exists workspace_event_outbox_workspace_idx
  on public.workspace_event_outbox(workspace_id, created_at desc);
create index if not exists workspace_event_outbox_dispatch_idx
  on public.workspace_event_outbox(created_at)
  where processed_at is null;

create table if not exists public.workspace_automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 100),
  event_type text not null check (event_type in ('invoice.created','invoice.status_changed','lead.created','lead.stage_changed','expense.created','stock.low_stock','integration.webhook_received')),
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  action_type text not null default 'create_task' check (action_type = 'create_task'),
  action_config jsonb not null default '{}'::jsonb check (jsonb_typeof(action_config) = 'object'),
  timezone text not null default 'UTC' check (length(timezone) between 1 and 80),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index if not exists workspace_automation_rules_event_idx
  on public.workspace_automation_rules(workspace_id, event_type, is_active);

create table if not exists public.workspace_automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  rule_id uuid not null,
  event_id uuid not null references public.workspace_event_outbox(id) on delete cascade,
  status text not null check (status in ('completed','skipped','failed')),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  foreign key (workspace_id, rule_id)
    references public.workspace_automation_rules(workspace_id, id) on delete cascade,
  unique (rule_id, event_id)
);
create index if not exists workspace_automation_runs_workspace_idx
  on public.workspace_automation_runs(workspace_id, started_at desc);

create table if not exists public.workspace_automation_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  rule_id uuid not null,
  source_event_id uuid not null references public.workspace_event_outbox(id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 160),
  description text not null default '' check (length(description) <= 2000),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','completed','dismissed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (workspace_id, rule_id)
    references public.workspace_automation_rules(workspace_id, id) on delete cascade,
  unique (workspace_id, rule_id, source_event_id)
);
create index if not exists workspace_automation_tasks_open_idx
  on public.workspace_automation_tasks(workspace_id, due_at)
  where status = 'open';

-- Event and scheduled rules share one queue, with bounded retries and visible dead letters.
alter table public.workspace_event_outbox
  drop constraint if exists workspace_event_outbox_event_type_check;
alter table public.workspace_event_outbox
  add constraint workspace_event_outbox_event_type_check
  check (event_type in ('invoice.created','invoice.status_changed','lead.created','lead.stage_changed','expense.created','stock.low_stock','integration.webhook_received','automation.schedule_due'));
alter table public.workspace_event_outbox
  drop constraint if exists workspace_event_outbox_entity_type_check;
alter table public.workspace_event_outbox
  add constraint workspace_event_outbox_entity_type_check
  check (entity_type in ('invoice','lead','expense','stock_item','integration_webhook','automation_schedule'));
alter table public.workspace_event_outbox
  add column if not exists processing_status text not null default 'pending',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now();
alter table public.workspace_event_outbox
  add constraint workspace_event_outbox_processing_status_check
  check (processing_status in ('pending','processing','processed','retrying','dead_letter'));
alter table public.workspace_event_outbox
  add constraint workspace_event_outbox_attempt_count_check
  check (attempt_count between 0 and 12);
drop index if exists public.workspace_event_outbox_dispatch_idx;
create index if not exists workspace_event_outbox_dispatch_idx
  on public.workspace_event_outbox(next_attempt_at, created_at)
  where processing_status in ('pending','retrying');

alter table public.workspace_automation_rules
  drop constraint if exists workspace_automation_rules_event_type_check;
alter table public.workspace_automation_rules
  add constraint workspace_automation_rules_event_type_check
  check (event_type in ('invoice.created','invoice.status_changed','lead.created','lead.stage_changed','expense.created','stock.low_stock','integration.webhook_received','automation.schedule_due'));
alter table public.workspace_automation_rules
  add column if not exists trigger_type text not null default 'event',
  add column if not exists schedule_frequency text,
  add column if not exists schedule_time_local time,
  add column if not exists schedule_days_of_week smallint[],
  add column if not exists next_run_at timestamptz;
alter table public.workspace_automation_rules
  add constraint workspace_automation_rules_trigger_type_check
  check (trigger_type in ('event','schedule'));
alter table public.workspace_automation_rules
  add constraint workspace_automation_rules_schedule_contract_check
  check (
    (trigger_type = 'event' and event_type <> 'automation.schedule_due'
      and schedule_frequency is null and schedule_time_local is null
      and schedule_days_of_week is null and next_run_at is null)
    or
    (trigger_type = 'schedule' and event_type = 'automation.schedule_due'
      and schedule_frequency is not null and schedule_frequency in ('daily','weekly') and schedule_time_local is not null
      and next_run_at is not null
      and ((schedule_frequency = 'daily' and schedule_days_of_week is null)
        or (schedule_frequency = 'weekly' and schedule_days_of_week is not null
          and cardinality(schedule_days_of_week) between 1 and 7
          and schedule_days_of_week <@ array[1,2,3,4,5,6,7]::smallint[]))
    )
  );
create index if not exists workspace_automation_rules_schedule_idx
  on public.workspace_automation_rules(next_run_at)
  where trigger_type = 'schedule' and is_active = true;

alter table public.workspace_automation_runs
  add column if not exists attempt_no integer not null default 1;
alter table public.workspace_automation_tasks
  add column if not exists escalated_at timestamptz,
  add column if not exists escalation_count integer not null default 0,
  add column if not exists escalation_reason text;

create table if not exists public.workspace_automation_preferences (
  workspace_id text primary key references public.workspace_settings(workspace_id) on delete cascade,
  timezone text not null default 'UTC' check (length(timezone) between 1 and 80),
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '08:00',
  escalation_enabled boolean not null default false,
  escalation_after_hours integer not null default 24 check (escalation_after_hours between 1 and 720),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_automation_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  task_id uuid not null references public.workspace_automation_tasks(id) on delete cascade,
  notification_type text not null check (notification_type in ('task_due','task_escalated')),
  title text not null check (length(btrim(title)) between 2 and 160),
  message text not null default '' check (length(message) <= 1000),
  available_at timestamptz not null default now(),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, task_id, notification_type)
);
create index if not exists workspace_automation_notifications_inbox_idx
  on public.workspace_automation_notifications(workspace_id, available_at desc)
  where read_at is null;

create table if not exists public.workspace_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp','text/csv')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  category text not null default 'general' check (category in ('general','invoice','quotation','purchase','expense','tax','contract','other')),
  retention_until date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index if not exists workspace_documents_workspace_idx
  on public.workspace_documents(workspace_id, category, created_at desc);

create table if not exists public.workspace_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (length(btrim(action)) between 2 and 100),
  entity_type text not null check (length(btrim(entity_type)) between 2 and 80),
  entity_id text,
  correlation_id uuid not null,
  outcome text not null default 'success' check (outcome in ('success','failed','denied')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);
-- Extend the existing Main Workspace audit table additively; preserve its prior history.
alter table public.workspace_audit_events
  add column if not exists correlation_id uuid;
update public.workspace_audit_events
set correlation_id = gen_random_uuid()
where correlation_id is null;
alter table public.workspace_audit_events
  alter column correlation_id set default gen_random_uuid(),
  alter column correlation_id set not null;
alter table public.workspace_audit_events
  add column if not exists outcome text not null default 'success';
alter table public.workspace_audit_events
  drop constraint if exists workspace_audit_events_outcome_check;
alter table public.workspace_audit_events
  add constraint workspace_audit_events_outcome_check
  check (outcome in ('success','failed','denied'));

create index if not exists workspace_audit_events_workspace_time_idx
  on public.workspace_audit_events(workspace_id, occurred_at desc);
create index if not exists workspace_audit_events_correlation_idx
  on public.workspace_audit_events(correlation_id);

-- Deterministic automation runs entirely in Postgres. No provider API or secret is required.
create extension if not exists pg_cron with schema pg_catalog;

-- These tables are only accessed by authenticated Edge Functions using the service role.
do $$
declare t text;
begin
  foreach t in array array[
    'workspace_integrations','workspace_webhook_subscriptions','workspace_event_outbox',
    'workspace_webhook_events','workspace_webhook_attempts','workspace_automation_rules','workspace_automation_runs',
    'workspace_automation_tasks','workspace_automation_preferences','workspace_automation_notifications','workspace_documents','workspace_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_deny_client_access', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (false) with check (false)', t || '_deny_client_access', t);
  end loop;
end $$;

-- Create webhook secrets in Supabase Vault and return the raw value only once to the authenticated owner.
create or replace function public.main_workspace_create_webhook_subscription(
  p_workspace_id text,
  p_user_id uuid,
  p_provider_key text,
  p_label text,
  p_event_types text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_secret text;
  v_secret_name text;
  v_subscription_id uuid;
begin
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = p_user_id
      and status = 'active' and role in ('admin','manager')
  ) then
    return jsonb_build_object('ok',false,'error','ACCESS_DENIED');
  end if;
  if p_provider_key not in ('shopify','custom')
    or p_label is null or length(btrim(p_label)) not between 2 and 100
    or p_event_types is null or cardinality(p_event_types) not between 1 and 8
    or cardinality(p_event_types) <> (select count(distinct x) from unnest(p_event_types) x) then
    return jsonb_build_object('ok',false,'error','INVALID_WEBHOOK_SUBSCRIPTION');
  end if;
  if p_provider_key = 'shopify'
    and not (p_event_types <@ array['orders/create','orders/updated','products/create','products/update','inventory_levels/update']::text[]) then
    return jsonb_build_object('ok',false,'error','INVALID_SHOPIFY_TOPICS');
  end if;
  if p_provider_key = 'custom'
    and not (p_event_types <@ array['invoice.created','invoice.status_changed','lead.created','lead.stage_changed','expense.created','stock.low_stock']::text[]) then
    return jsonb_build_object('ok',false,'error','INVALID_CUSTOM_EVENT_TYPES');
  end if;

  v_secret := encode(gen_random_bytes(32), 'hex');
  v_secret_name := 'plivex_webhook_' || gen_random_uuid()::text;
  perform vault.create_secret(v_secret, v_secret_name, 'Private signing secret for Main Workspace webhook subscription');

  insert into public.workspace_webhook_subscriptions(
    workspace_id, provider_key, label, secret_name, event_types, created_by
  ) values (
    p_workspace_id, p_provider_key, btrim(p_label), v_secret_name, p_event_types, p_user_id
  ) returning id into v_subscription_id;

  insert into public.workspace_audit_events(
    workspace_id, actor_id, action, entity_type, entity_id, correlation_id, outcome, metadata
  ) values (
    p_workspace_id, p_user_id, 'webhook.subscription_created', 'webhook_subscription',
    v_subscription_id::text, gen_random_uuid(), 'success',
    jsonb_build_object('provider_key',p_provider_key,'event_count',cardinality(p_event_types))
  );

  return jsonb_build_object(
    'ok',true,
    'subscription_id',v_subscription_id,
    'provider_key',p_provider_key,
    'event_types',p_event_types,
    'secret',v_secret
  );
end;
$function$;
revoke all on function public.main_workspace_create_webhook_subscription(text,uuid,text,text,text[]) from public, anon, authenticated;
grant execute on function public.main_workspace_create_webhook_subscription(text,uuid,text,text,text[]) to service_role;

create or replace function public.main_workspace_get_webhook_secret(p_subscription_id uuid)
returns text
language sql
security definer
set search_path = pg_catalog, public, vault
as $function$
  select d.decrypted_secret
  from public.workspace_webhook_subscriptions s
  join vault.decrypted_secrets d on d.name = s.secret_name
  where s.id = p_subscription_id and s.is_active = true
  limit 1;
$function$;
revoke all on function public.main_workspace_get_webhook_secret(uuid) from public, anon, authenticated;
grant execute on function public.main_workspace_get_webhook_secret(uuid) to service_role;

-- Verified webhook receipts are dispatched to the Main Workspace event outbox with bounded retries.
create or replace function public.process_main_workspace_webhook_events(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event record;
  v_attempt integer;
  v_delay integer;
  v_status text;
  v_processed integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid webhook batch size';
  end if;

  for v_event in
    select id, workspace_id, subscription_id, provider_key, provider_event_id,
      event_type, event_timestamp, payload_sha256, attempt_count, received_at
    from public.workspace_webhook_events
    where status in ('pending','retrying') and next_attempt_at <= now()
    order by received_at, id
    limit p_limit
    for update skip locked
  loop
    v_attempt := v_event.attempt_count + 1;
    begin
      update public.workspace_webhook_events
      set status = 'processing', attempt_count = v_attempt
      where id = v_event.id;

      insert into public.workspace_event_outbox(
        workspace_id, event_type, entity_type, entity_id, dedupe_key, payload, occurred_at
      ) values (
        v_event.workspace_id,
        'integration.webhook_received',
        'integration_webhook',
        v_event.id::text,
        'webhook:' || v_event.subscription_id::text || ':' || v_event.provider_event_id,
        jsonb_build_object(
          'provider_key',v_event.provider_key,
          'provider_event_id',v_event.provider_event_id,
          'event_type',v_event.event_type,
          'payload_sha256',v_event.payload_sha256,
          'webhook_event_id',v_event.id
        ),
        coalesce(v_event.event_timestamp,v_event.received_at)
      )
      on conflict (dedupe_key) do nothing;

      update public.workspace_webhook_events
      set status = 'processed', processed_at = clock_timestamp(),
        next_attempt_at = clock_timestamp(), last_error_code = null
      where id = v_event.id;

      insert into public.workspace_webhook_attempts(workspace_id,event_id,attempt_no,status,metadata)
      values(v_event.workspace_id,v_event.id,v_attempt,'processed',jsonb_build_object('outbox_event_created',true));
      v_processed := v_processed + 1;
    exception when others then
      v_status := case when v_attempt >= 12 then 'dead_letter' else 'retrying' end;
      v_delay := least(21600, (30 * power(2::numeric, least(v_attempt,10)))::integer);
      update public.workspace_webhook_events
      set status = v_status,
        attempt_count = v_attempt,
        next_attempt_at = clock_timestamp() + make_interval(secs => v_delay),
        last_error_code = 'WEBHOOK_DISPATCH_FAILED'
      where id = v_event.id;
      insert into public.workspace_webhook_attempts(workspace_id,event_id,attempt_no,status,error_code,metadata)
      values(v_event.workspace_id,v_event.id,v_attempt,v_status,'WEBHOOK_DISPATCH_FAILED',jsonb_build_object('retry_delay_seconds',v_delay));
    end;
  end loop;

  return v_processed;
end;
$function$;
revoke all on function public.process_main_workspace_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.process_main_workspace_webhook_events(integer) to service_role;

select cron.schedule(
  'plivex-workspace-webhook-sweep',
  '* * * * *',
  'select public.process_main_workspace_webhook_events(50);'
);

-- Claim events with SKIP LOCKED and make task creation/run history idempotent.
create or replace function public.process_main_workspace_automation_events(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event record;
  v_rule record;
  v_conditions jsonb;
  v_config jsonb;
  v_matched boolean;
  v_due_hours integer;
  v_due_at timestamptz;
  v_processed integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid automation batch size';
  end if;

  for v_event in
    select id, workspace_id, event_type, entity_type, entity_id, payload, occurred_at
    from public.workspace_event_outbox
    where processed_at is null
    order by created_at, id
    limit p_limit
    for update skip locked
  loop
    for v_rule in
      select id, name, conditions, action_type, action_config
      from public.workspace_automation_rules
      where workspace_id = v_event.workspace_id
        and event_type = v_event.event_type
        and is_active = true
      order by created_at, id
    loop
      v_conditions := coalesce(v_rule.conditions, '{}'::jsonb);
      v_config := coalesce(v_rule.action_config, '{}'::jsonb);
      v_matched := true;

      if v_conditions ? 'status_equals'
        and (v_event.payload ->> 'status') is distinct from (v_conditions ->> 'status_equals') then
        v_matched := false;
      end if;
      if v_conditions ? 'stage_equals'
        and (v_event.payload ->> 'stage') is distinct from (v_conditions ->> 'stage_equals') then
        v_matched := false;
      end if;

      if v_matched and v_rule.action_type = 'create_task' then
        v_due_hours := null;
        if jsonb_typeof(v_config -> 'due_in_hours') = 'number' then
          v_due_hours := (v_config ->> 'due_in_hours')::integer;
        end if;
        v_due_at := case
          when v_due_hours between 0 and 720 then v_event.occurred_at + make_interval(hours => v_due_hours)
          else null
        end;

        insert into public.workspace_automation_tasks(
          workspace_id, rule_id, source_event_id, title, description, due_at
        ) values (
          v_event.workspace_id,
          v_rule.id,
          v_event.id,
          coalesce(nullif(btrim(v_config ->> 'title'), ''), v_rule.name),
          left(coalesce(v_config ->> 'description', ''), 2000),
          v_due_at
        )
        on conflict (workspace_id, rule_id, source_event_id) do nothing;
      end if;

      insert into public.workspace_automation_runs(
        workspace_id, rule_id, event_id, status
      ) values (
        v_event.workspace_id,
        v_rule.id,
        v_event.id,
        case when v_matched then 'completed' else 'skipped' end
      )
      on conflict (rule_id, event_id) do nothing;
    end loop;

    update public.workspace_event_outbox
    set processed_at = clock_timestamp(), processing_error_code = null
    where id = v_event.id and processed_at is null;
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$function$;
revoke all on function public.process_main_workspace_automation_events(integer) from public, anon, authenticated;
grant execute on function public.process_main_workspace_automation_events(integer) to service_role;

select cron.schedule(
  'plivex-workspace-automation-sweep',
  '* * * * *',
  'select public.process_main_workspace_automation_events(50);'
);

-- Capture only minimal, non-PII event metadata. Delivery payloads never contain customer contact details.
create or replace function public.capture_main_workspace_business_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else '{}'::jsonb end;
  v_workspace_id text := v_new ->> 'workspace_id';
  v_entity_id text := v_new ->> 'id';
  v_event_type text;
  v_entity_type text;
  v_payload jsonb := '{}'::jsonb;
begin
  if v_workspace_id is null or v_entity_id is null then return NEW; end if;

  if TG_TABLE_NAME = 'invoices' then
    v_entity_type := 'invoice';
    if TG_OP = 'INSERT' then
      v_event_type := 'invoice.created';
    elsif coalesce(v_new ->> 'status','') is distinct from coalesce(v_old ->> 'status','') then
      v_event_type := 'invoice.status_changed';
    end if;
    v_payload := jsonb_build_object(
      'invoice_id', v_entity_id,
      'status', v_new ->> 'status',
      'currency', v_new ->> 'currency',
      'due_date', v_new ->> 'due_date'
    );
  elsif TG_TABLE_NAME = 'leads' then
    v_entity_type := 'lead';
    if TG_OP = 'INSERT' then
      v_event_type := 'lead.created';
    elsif coalesce(v_new ->> 'stage','') is distinct from coalesce(v_old ->> 'stage','') then
      v_event_type := 'lead.stage_changed';
    end if;
    v_payload := jsonb_build_object('lead_id',v_entity_id,'stage',v_new ->> 'stage','next_follow_up_at',v_new ->> 'next_follow_up_at');
  elsif TG_TABLE_NAME = 'expenses' then
    v_entity_type := 'expense';
    if TG_OP = 'INSERT' then
      v_event_type := 'expense.created';
      v_payload := jsonb_build_object('expense_id',v_entity_id,'currency_code',v_new ->> 'currency_code','date',v_new ->> 'date');
    end if;
  elsif TG_TABLE_NAME = 'stock' then
    v_entity_type := 'stock_item';
    if TG_OP = 'INSERT' then
      if nullif(v_new ->> 'low_stock','') is not null and (v_new ->> 'quantity')::numeric <= (v_new ->> 'low_stock')::numeric then
        v_event_type := 'stock.low_stock';
      end if;
    elsif nullif(v_new ->> 'low_stock','') is not null
      and (v_new ->> 'quantity')::numeric <= (v_new ->> 'low_stock')::numeric
      and (nullif(v_old ->> 'low_stock','') is null or (v_old ->> 'quantity')::numeric > (v_old ->> 'low_stock')::numeric) then
      v_event_type := 'stock.low_stock';
    end if;
    v_payload := jsonb_build_object('stock_item_id',v_entity_id,'quantity',v_new ->> 'quantity','low_stock',v_new ->> 'low_stock');
  end if;

  if v_event_type is not null then
    insert into public.workspace_event_outbox(workspace_id,event_type,entity_type,entity_id,payload)
    values(v_workspace_id,v_event_type,v_entity_type,v_entity_id,v_payload);
  end if;
  return NEW;
end;
$function$;
revoke all on function public.capture_main_workspace_business_event() from public, anon, authenticated;
grant execute on function public.capture_main_workspace_business_event() to service_role;

drop trigger if exists main_workspace_invoice_event on public.invoices;
create trigger main_workspace_invoice_event after insert or update of status on public.invoices
for each row execute function public.capture_main_workspace_business_event();
drop trigger if exists main_workspace_lead_event on public.leads;
create trigger main_workspace_lead_event after insert or update of stage on public.leads
for each row execute function public.capture_main_workspace_business_event();
drop trigger if exists main_workspace_expense_event on public.expenses;
create trigger main_workspace_expense_event after insert on public.expenses
for each row execute function public.capture_main_workspace_business_event();
drop trigger if exists main_workspace_stock_event on public.stock;
create trigger main_workspace_stock_event after insert or update of quantity, low_stock on public.stock
for each row execute function public.capture_main_workspace_business_event();

commit;
