-- Stage 3 migration contract checks run only against the disposable CI candidate database.
do $$
declare
  v_table text;
  v_required text[] := array[
    'workspace_integrations',
    'workspace_webhook_subscriptions',
    'workspace_event_outbox',
    'workspace_webhook_deliveries',
    'workspace_automation_rules',
    'workspace_automation_runs',
    'workspace_automation_tasks',
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

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspace_audit_events' and column_name='correlation_id')
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspace_audit_events' and column_name='outcome') then
    raise exception 'Stage 3 audit correlation/outcome fields missing';
  end if;

  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_webhook_deliveries_retry_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_automation_tasks_open_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_documents_workspace_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_audit_events_correlation_idx') then
    raise exception 'Stage 3 retry, automation task or document index missing';
  end if;
end $$;

do $
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
end $;

select 'PASS: Stage 3 tables, RLS, least-privilege grants, event triggers, API idempotency and indexes';
