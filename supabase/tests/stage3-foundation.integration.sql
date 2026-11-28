begin;
-- Stage 3 migration contract checks run only against the disposable CI candidate database.
do $$
declare
  v_table text;
  v_required text[] := array[
    'workspace_integrations',
    'workspace_webhook_subscriptions',
    'workspace_event_outbox',
    'workspace_webhook_events',
    'workspace_webhook_attempts',
    'workspace_automation_rules',
    'workspace_automation_runs',
    'workspace_automation_tasks',
    'workspace_automation_preferences',
    'workspace_automation_notifications',
    'workspace_documents',
    'workspace_audit_events'
  ];
  v_trigger text;
begin
  foreach v_table in array v_required loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Stage 3 table missing: %', v_table;
    end if;
    if not coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || v_table)), false) then
      raise exception 'RLS is not enabled on Stage 3 table: %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      or has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') then
      raise exception 'Client role unexpectedly has direct SELECT on Stage 3 table: %', v_table;
    end if;
    if not has_table_privilege('service_role', 'public.' || v_table, 'SELECT') then
      raise exception 'Service role cannot read Stage 3 table: %', v_table;
    end if;
  end loop;

  foreach v_trigger in array array[
    'main_workspace_invoice_event',
    'main_workspace_lead_event',
    'main_workspace_expense_event',
    'main_workspace_stock_event'
  ] loop
    if not exists (select 1 from pg_trigger where tgname = v_trigger and not tgisinternal) then
      raise exception 'Stage 3 business event trigger missing: %', v_trigger;
    end if;
  end loop;

  if not coalesce((select prosecdef from pg_proc where oid = 'public.capture_main_workspace_business_event()'::regprocedure), false) then
    raise exception 'Stage 3 event capture function must run with its tightly scoped owner privileges';
  end if;
  if has_function_privilege('anon', 'public.capture_main_workspace_business_event()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.capture_main_workspace_business_event()', 'EXECUTE') then
    raise exception 'Stage 3 event capture function is exposed to client roles';
  end if;
  if not has_function_privilege('service_role', 'public.capture_main_workspace_business_event()', 'EXECUTE') then
    raise exception 'Service role function grant missing';
  end if;

  if to_regclass('public.public_api_idempotency') is null
    or not coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.public_api_idempotency')), false)
    or has_table_privilege('anon','public.public_api_idempotency','SELECT')
    or has_table_privilege('authenticated','public.public_api_idempotency','SELECT')
    or not has_table_privilege('service_role','public.public_api_idempotency','SELECT') then
    raise exception 'Public API idempotency table is missing or not private';
  end if;
  if not coalesce((select prosecdef from pg_proc where oid = 'public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric)'::regprocedure), false)
    or has_function_privilege('anon','public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric)','EXECUTE')
    or has_function_privilege('authenticated','public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric)','EXECUTE')
    or not has_function_privilege('service_role','public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric)','EXECUTE') then
    raise exception 'Public API lead write RPC is not least-privilege';
  end if;
  if not exists (select 1 from cron.job where jobname='plivex-public-api-idempotency-cleanup' and schedule='15 2 * * *') then
    raise exception 'Public API idempotency cleanup job missing';
  end if;

  if not coalesce((select prosecdef from pg_proc where oid = 'public.process_main_workspace_webhook_events(integer)'::regprocedure), false)
    or has_function_privilege('anon','public.process_main_workspace_webhook_events(integer)','EXECUTE')
    or has_function_privilege('authenticated','public.process_main_workspace_webhook_events(integer)','EXECUTE')
    or not has_function_privilege('service_role','public.process_main_workspace_webhook_events(integer)','EXECUTE') then
    raise exception 'Stage 3 webhook worker privileges are not least-privilege';
  end if;
  if not coalesce((select prosecdef from pg_proc where oid = 'public.main_workspace_create_webhook_subscription(text,uuid,text,text,text[])'::regprocedure), false)
    or has_function_privilege('anon','public.main_workspace_create_webhook_subscription(text,uuid,text,text,text[])','EXECUTE')
    or has_function_privilege('authenticated','public.main_workspace_create_webhook_subscription(text,uuid,text,text,text[])','EXECUTE')
    or not has_function_privilege('service_role','public.main_workspace_create_webhook_subscription(text,uuid,text,text,text[])','EXECUTE') then
    raise exception 'Webhook subscription creation RPC is not least-privilege';
  end if;
  if not exists (select 1 from cron.job where jobname='plivex-workspace-webhook-sweep' and schedule='* * * * *') then
    raise exception 'Stage 3 webhook retry schedule missing';
  end if;
  if not coalesce((select prosecdef from pg_proc where oid = 'public.main_workspace_get_webhook_secret(uuid)'::regprocedure), false)
    or has_function_privilege('anon','public.main_workspace_get_webhook_secret(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.main_workspace_get_webhook_secret(uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.main_workspace_get_webhook_secret(uuid)','EXECUTE') then
    raise exception 'Vault webhook secret reader is not least-privilege';
  end if;

  if not coalesce((select prosecdef from pg_proc where oid = 'public.process_main_workspace_automation_events(integer)'::regprocedure), false) then
    raise exception 'Stage 3 automation worker is not security definer';
  end if;
  if has_function_privilege('anon', 'public.process_main_workspace_automation_events(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.process_main_workspace_automation_events(integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.process_main_workspace_automation_events(integer)', 'EXECUTE') then
    raise exception 'Stage 3 automation worker privileges are not least-privilege';
  end if;

  if not exists (select 1 from cron.job where jobname='plivex-workspace-automation-sweep' and schedule='* * * * *') then
    raise exception 'Stage 3 automation cron job missing';
  end if;
  if not coalesce((select prosecdef from pg_proc where oid = 'public.main_workspace_next_automation_run_at(text,text,time,smallint[])'::regprocedure), false)
    or has_function_privilege('anon','public.main_workspace_next_automation_run_at(text,text,time,smallint[])','EXECUTE')
    or has_function_privilege('authenticated','public.main_workspace_next_automation_run_at(text,text,time,smallint[])','EXECUTE')
    or not has_function_privilege('service_role','public.main_workspace_next_automation_run_at(text,text,time,smallint[])','EXECUTE') then
    raise exception 'Timezone schedule calculation RPC is not least-privilege';
  end if;
  if not coalesce((select prosecdef from pg_proc where oid = 'public.process_main_workspace_scheduled_automation_events(integer)'::regprocedure), false)
    or not coalesce((select prosecdef from pg_proc where oid = 'public.process_main_workspace_automation_escalations(integer)'::regprocedure), false) then
    raise exception 'Scheduled automation or escalation worker must be security definer';
  end if;
  if not exists (select 1 from cron.job where jobname='plivex-workspace-scheduled-automation-sweep' and schedule='* * * * *')
    or not exists (select 1 from cron.job where jobname='plivex-workspace-automation-escalations' and schedule='*/5 * * * *') then
    raise exception 'Scheduled automation or escalation cron job missing';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspace_audit_events' and column_name='correlation_id')
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspace_audit_events' and column_name='outcome') then
    raise exception 'Stage 3 audit correlation/outcome fields missing';
  end if;

  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_webhook_events_retry_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_webhook_attempts_event_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_automation_tasks_open_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_automation_rules_schedule_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_automation_notifications_inbox_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_documents_workspace_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_audit_events_correlation_idx') then
    raise exception 'Stage 3 retry, automation task or document index missing';
  end if;
end $$;

do $$
declare
  v_user uuid := '00000000-0000-4000-8000-000000000991';
  v_workspace text := 'stage3-api-idempotency-test';
  v_key uuid;
  v_correlation uuid := '00000000-0000-4000-8000-000000000992';
  v_hash text := encode(digest('{"name":"Stage 3 API Lead","company":null,"email":null,"phone":null,"requirement":null,"value":0}', 'sha256'), 'hex');
  v_first jsonb;
  v_replay jsonb;
  v_conflict jsonb;
  v_lead_id text;
begin
  insert into auth.users(id,aud,role,email,created_at,updated_at)
  values (v_user,'authenticated','authenticated','stage3-api-test@example.test',now(),now());

  insert into public.workspace_settings(workspace_id,country_code,locale_code,currency_code,created_by)
  values (v_workspace,'US','en-US','USD',v_user);

  insert into public.public_api_keys(workspace_id,created_by,label,key_hash,key_prefix,scopes,expires_at)
  values (v_workspace,v_user,'Stage 3 test key',repeat('a',64),'plx_test01',array['workspace.read','leads.write'],now()+interval '1 day')
  returning id into v_key;

  -- The lead-write RPC is service-role-only. Simulate its Edge Function JWT
  -- context so the plan-limit trigger follows the same trusted server path.
  perform set_config('request.jwt.claim.role','service_role',true);

  v_first := public.main_workspace_api_create_lead(
    v_key,'stage3-api-lead-0001',v_hash,v_correlation,'Stage 3 API Lead',null,null,null,null,0
  );
  if coalesce((v_first->>'ok')::boolean,false) is not true
    or coalesce((v_first->>'replayed')::boolean,true) is not false then
    raise exception 'First idempotent API write did not create a new lead: %',v_first;
  end if;
  v_lead_id := v_first #>> '{lead,id}';

  v_replay := public.main_workspace_api_create_lead(
    v_key,'stage3-api-lead-0001',v_hash,v_correlation,'Stage 3 API Lead',null,null,null,null,0
  );
  if coalesce((v_replay->>'ok')::boolean,false) is not true
    or coalesce((v_replay->>'replayed')::boolean,false) is not true
    or (v_replay #>> '{lead,id}') is distinct from v_lead_id then
    raise exception 'Idempotent retry did not return the original lead: %',v_replay;
  end if;

  v_conflict := public.main_workspace_api_create_lead(
    v_key,'stage3-api-lead-0001',repeat('b',64),v_correlation,'Different Lead',null,null,null,null,0
  );
  if v_conflict->>'error' <> 'IDEMPOTENCY_KEY_REUSED' then
    raise exception 'Reused idempotency key with a different payload was not rejected: %',v_conflict;
  end if;

  if (select count(*) from public.leads where workspace_id=v_workspace) <> 1 then
    raise exception 'Idempotent API write created duplicate leads';
  end if;
  if (select count(*) from public.workspace_audit_events where workspace_id=v_workspace and action='api.lead_created') <> 1 then
    raise exception 'Idempotent API write did not produce exactly one audit event';
  end if;
end $$;


do $
declare
  v_workspace text := 'stage3-api-idempotency-test';
  v_user uuid := '00000000-0000-4000-8000-000000000991';
  v_rule uuid;
  v_event uuid;
  v_reminder_event uuid := '00000000-0000-4000-8000-000000000996';
  v_reminder_task uuid;
  v_overdue_task uuid;
  v_next timestamptz;
  v_count integer;
begin
  v_next := public.main_workspace_next_automation_run_at('UTC','daily',time '23:59',null);
  if v_next <= now() then raise exception 'Daily timezone schedule helper returned a non-future time'; end if;
  v_next := public.main_workspace_next_automation_run_at('UTC','weekly',time '23:59',array[1,3,5]::smallint[]);
  if v_next <= now() then raise exception 'Weekly timezone schedule helper returned a non-future time'; end if;

  insert into public.workspace_automation_rules(
    workspace_id,name,event_type,trigger_type,conditions,action_type,action_config,
    timezone,schedule_frequency,schedule_time_local,schedule_days_of_week,next_run_at,created_by,is_active
  ) values (
    v_workspace,'Stage 3 scheduled review','automation.schedule_due','schedule','{}'::jsonb,
    'create_task','{"title":"Scheduled review task","description":"Created by schedule worker","due_in_hours":1}'::jsonb,
    'UTC','daily',time '00:00',null,now()-interval '1 minute',v_user,true
  ) returning id into v_rule;

  v_count := public.process_main_workspace_scheduled_automation_events(10);
  if v_count <> 1 then raise exception 'Scheduled automation worker did not enqueue exactly one event: %',v_count; end if;
  select id into v_event from public.workspace_event_outbox
  where event_type='automation.schedule_due' and entity_id=v_rule::text
  order by created_at desc limit 1;
  if v_event is null then raise exception 'Scheduled automation event was not created'; end if;
  if (select next_run_at from public.workspace_automation_rules where id=v_rule) <= now() then
    raise exception 'Scheduled automation next_run_at was not advanced';
  end if;

  perform public.process_main_workspace_automation_events(20);
  select id into v_overdue_task from public.workspace_automation_tasks
  where rule_id=v_rule and source_event_id=v_event;
  if v_overdue_task is null or (select status from public.workspace_automation_runs where rule_id=v_rule and event_id=v_event) <> 'completed' then
    raise exception 'Scheduled automation event did not create its task and run record';
  end if;

  update public.workspace_automation_tasks set due_at=now()-interval '2 hours' where id=v_overdue_task;
  insert into public.workspace_event_outbox(
    id,workspace_id,event_type,entity_type,entity_id,dedupe_key,payload,occurred_at
  ) values (
    v_reminder_event,v_workspace,'automation.schedule_due','automation_schedule',v_rule::text,
    'stage3-reminder-source-event','{}'::jsonb,now()
  );
  insert into public.workspace_automation_tasks(
    workspace_id,rule_id,source_event_id,title,description,due_at
  ) values (
    v_workspace,v_rule,v_reminder_event,'Stage 3 reminder task','Due reminder test',now()+interval '30 minutes'
  ) returning id into v_reminder_task;

  insert into public.workspace_automation_preferences(
    workspace_id,timezone,reminders_enabled,quiet_hours_start,quiet_hours_end,
    escalation_enabled,escalation_after_hours,created_by
  ) values (
    v_workspace,'UTC',true,time '00:00',time '00:00',true,1,v_user
  ) on conflict (workspace_id) do update set
    timezone=excluded.timezone,reminders_enabled=excluded.reminders_enabled,
    quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,
    escalation_enabled=excluded.escalation_enabled,escalation_after_hours=excluded.escalation_after_hours;

  v_count := public.process_main_workspace_automation_escalations(10);
  if v_count <> 2 then raise exception 'Reminder/escalation worker did not process both due and overdue tasks: %',v_count; end if;
  if not exists (select 1 from public.workspace_automation_notifications where task_id=v_reminder_task and notification_type='task_due')
    or not exists (select 1 from public.workspace_automation_notifications where task_id=v_overdue_task and notification_type='task_escalated')
    or (select escalated_at from public.workspace_automation_tasks where id=v_overdue_task) is null then
    raise exception 'Timezone-aware reminders or overdue escalation notification missing';
  end if;
end $;

create or replace function public.test_stage3_fail_webhook_outbox()
returns trigger language plpgsql as $test$
begin
  if new.entity_id = '00000000-0000-4000-8000-000000000995' then
    raise exception 'TEST_WEBHOOK_OUTBOX_FAILURE';
  end if;
  return new;
end;
$test$;
drop trigger if exists test_stage3_fail_webhook_outbox on public.workspace_event_outbox;
create trigger test_stage3_fail_webhook_outbox before insert on public.workspace_event_outbox
for each row execute function public.test_stage3_fail_webhook_outbox();

do $$
declare
  v_workspace text := 'stage3-api-idempotency-test';
  v_user uuid := '00000000-0000-4000-8000-000000000991';
  v_subscription uuid := '00000000-0000-4000-8000-000000000993';
  v_success_event uuid := '00000000-0000-4000-8000-000000000994';
  v_failure_event uuid := '00000000-0000-4000-8000-000000000995';
  v_processed integer;
  v_state text;
  v_attempts integer;
begin
  insert into public.workspace_webhook_subscriptions(
    id,workspace_id,provider_key,label,secret_name,event_types,created_by
  ) values (
    v_subscription,v_workspace,'custom','Stage 3 test webhook',
    'plivex_webhook_00000000-0000-4000-8000-000000000993',
    array['invoice.created'],v_user
  );

  insert into public.workspace_webhook_events(
    id,workspace_id,subscription_id,provider_key,provider_event_id,event_type,
    event_timestamp,payload,payload_sha256,signature_verified
  ) values (
    v_success_event,v_workspace,v_subscription,'custom','evt_stage3_success_001','invoice.created',
    now(),'{"type":"invoice.created"}'::jsonb,repeat('a',64),true
  );
  insert into public.workspace_webhook_events(
    workspace_id,subscription_id,provider_key,provider_event_id,event_type,
    event_timestamp,payload,payload_sha256,signature_verified
  ) values (
    v_workspace,v_subscription,'custom','evt_stage3_success_001','invoice.created',
    now(),'{"type":"invoice.created"}'::jsonb,repeat('a',64),true
  ) on conflict (subscription_id,provider_event_id) do nothing;

  if (select count(*) from public.workspace_webhook_events where subscription_id=v_subscription and provider_event_id='evt_stage3_success_001') <> 1 then
    raise exception 'Webhook replay was not deduplicated';
  end if;

  v_processed := public.process_main_workspace_webhook_events(10);
  select status,attempt_count into v_state,v_attempts from public.workspace_webhook_events where id=v_success_event;
  if v_processed <> 1 or v_state <> 'processed' or v_attempts <> 1 then
    raise exception 'Verified webhook event did not reach processed state: %, %, %',v_processed,v_state,v_attempts;
  end if;
  if (select count(*) from public.workspace_event_outbox where dedupe_key='webhook:' || v_subscription::text || ':evt_stage3_success_001') <> 1 then
    raise exception 'Webhook event was not emitted to the outbox exactly once';
  end if;

  insert into public.workspace_webhook_events(
    id,workspace_id,subscription_id,provider_key,provider_event_id,event_type,
    event_timestamp,payload,payload_sha256,signature_verified
  ) values (
    v_failure_event,v_workspace,v_subscription,'custom','evt_stage3_failure_001','invoice.created',
    now(),'{"type":"invoice.created"}'::jsonb,repeat('b',64),true
  );
  perform public.process_main_workspace_webhook_events(10);
  select status,attempt_count into v_state,v_attempts from public.workspace_webhook_events where id=v_failure_event;
  if v_state <> 'retrying' or v_attempts <> 1
    or (select count(*) from public.workspace_webhook_attempts where event_id=v_failure_event and status='retrying') <> 1 then
    raise exception 'Webhook failure did not schedule a bounded retry: %, %',v_state,v_attempts;
  end if;

  update public.workspace_webhook_events
  set attempt_count=11,status='retrying',next_attempt_at=now()
  where id=v_failure_event;
  perform public.process_main_workspace_webhook_events(10);
  select status,attempt_count into v_state,v_attempts from public.workspace_webhook_events where id=v_failure_event;
  if v_state <> 'dead_letter' or v_attempts <> 12
    or (select count(*) from public.workspace_webhook_attempts where event_id=v_failure_event and status='dead_letter') <> 1 then
    raise exception 'Webhook retry budget did not dead-letter the event: %, %',v_state,v_attempts;
  end if;

end $$;
drop trigger if exists test_stage3_fail_webhook_outbox on public.workspace_event_outbox;
drop function if exists public.test_stage3_fail_webhook_outbox();

select 'PASS: Stage 3 tables, RLS, least-privilege grants, event triggers, webhook replay/retry, API idempotency and indexes';

rollback;
