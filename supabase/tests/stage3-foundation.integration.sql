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
    'workspace_documents'
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

  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_webhook_deliveries_retry_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_automation_tasks_open_idx')
    or not exists (select 1 from pg_indexes where schemaname='public' and indexname='workspace_documents_workspace_idx') then
    raise exception 'Stage 3 retry, automation task or document index missing';
  end if;
end $$;

select 'PASS: Stage 3 tables, RLS, least-privilege grants, event triggers and indexes';
