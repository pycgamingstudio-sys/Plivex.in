\set ON_ERROR_STOP on
-- Runs in the disposable candidate database after global-invoice-ledger.integration.sql.
SET ROLE service_role;
DO $global_multicurrency_expense$
DECLARE
  foreign_expense jsonb;
  retry_expense jsonb;
  conflict_expense jsonb;
  missing_fx jsonb;
  base_expense jsonb;
  legacy_expense jsonb;
  expense_id uuid;
  history_count bigint;
  snapshot_count bigint;
  idem uuid := '88888888-eeee-4888-8888-888888888888';
BEGIN
  foreign_expense := public.global_create_expense_with_fx(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Travel','Rail operator',10000,'USD','2026-11-15',idem,
    85,100,'https://www.bankofengland.co.uk/boeapps/database/Rates.asp',
    'Reviewed rate fixture','2026-11-15T00:00:00Z','Foreign currency expense fixture'
  );
  IF foreign_expense->>'ok'<>'true' OR foreign_expense->>'duplicate'<>'false'
    OR (foreign_expense->'record'->>'amount_minor')::bigint<>8500
    OR foreign_expense->'record'->>'currency_code'<>'GBP'
    OR (foreign_expense->'record'->>'transaction_amount_minor')::bigint<>10000
    OR foreign_expense->'record'->>'transaction_currency_code'<>'USD'
    OR foreign_expense->'record'->>'fx_snapshot_id' IS NULL THEN
    RAISE EXCEPTION 'Foreign-currency expense conversion/provenance failed: %',foreign_expense;
  END IF;
  expense_id := (foreign_expense->'record'->>'id')::uuid;

  retry_expense := public.global_create_expense_with_fx(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Travel','Rail operator',10000,'USD','2026-11-15',idem,
    85,100,'https://www.bankofengland.co.uk/boeapps/database/Rates.asp',
    'Reviewed rate fixture','2026-11-15T00:00:00Z','Foreign currency expense fixture'
  );
  IF retry_expense->>'ok'<>'true' OR retry_expense->>'duplicate'<>'true'
    OR (retry_expense->'record'->>'id')::uuid<>expense_id THEN
    RAISE EXCEPTION 'Foreign-currency expense retry was not idempotent: %',retry_expense;
  END IF;

  conflict_expense := public.global_create_expense_with_fx(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Travel','Rail operator',11000,'USD','2026-11-15',idem,
    85,100,'https://www.bankofengland.co.uk/boeapps/database/Rates.asp',
    'Reviewed rate fixture','2026-11-15T00:00:00Z','Foreign currency expense fixture'
  );
  IF conflict_expense->>'reason'<>'idempotency_conflict' THEN
    RAISE EXCEPTION 'Expense idempotency conflict was not rejected: %',conflict_expense;
  END IF;

  missing_fx := public.global_create_expense_with_fx(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Travel','Rail operator',10000,'USD','2026-11-15',
    '99999999-eeee-4999-8999-999999999999'
  );
  IF missing_fx->>'reason'<>'fx_snapshot_required' THEN
    RAISE EXCEPTION 'Foreign-currency expense without an FX snapshot was not rejected: %',missing_fx;
  END IF;

  base_expense := public.global_create_expense_with_fx(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Software','SaaS provider',2500,'GBP','2026-11-15',
    'aaaaaaaa-eeee-4aaa-8aaa-aaaaaaaaaaaa'
  );
  IF base_expense->>'ok'<>'true'
    OR (base_expense->'record'->>'amount_minor')::bigint<>2500
    OR base_expense->'record'->>'currency_code'<>'GBP'
    OR base_expense->'record'->>'fx_snapshot_id' IS NOT NULL THEN
    RAISE EXCEPTION 'Same-currency expense should not create an FX snapshot: %',base_expense;
  END IF;

  -- The legacy server-side business-record RPC remains compatible for base-currency expenses.
  legacy_expense := public.global_business_records(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'expenses','create',NULL,
    jsonb_build_object('category','Office','amount_minor',500,'currency_code','GBP','expense_date','2026-11-15'),
    50
  );
  IF legacy_expense->>'ok'<>'true'
    OR (legacy_expense->'record'->>'transaction_amount_minor')::bigint<>500
    OR legacy_expense->'record'->>'transaction_currency_code'<>'GBP' THEN
    RAISE EXCEPTION 'Legacy base-currency expense insert did not populate transaction fields: %',legacy_expense;
  END IF;

  SELECT count(*) INTO history_count FROM global.currency_conversion_history
    WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND snapshot_id=(foreign_expense->'record'->>'fx_snapshot_id')::uuid;
  SELECT count(*) INTO snapshot_count FROM global.exchange_rate_snapshots
    WHERE id=(foreign_expense->'record'->>'fx_snapshot_id')::uuid;
  IF history_count<>1 OR snapshot_count<>1 THEN
    RAISE EXCEPTION 'FX snapshot and immutable conversion history were not stored exactly once';
  END IF;
END
$global_multicurrency_expense$;
RESET ROLE;

SET ROLE authenticated;
DO $rpc_privileges$
BEGIN
  IF has_function_privilege('authenticated','public.global_create_expense_with_fx(uuid,uuid,text,text,bigint,text,date,uuid,numeric,numeric,text,text,timestamp with time zone,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated role can execute Global FX expense RPC directly';
  END IF;
END
$rpc_privileges$;
RESET ROLE;

SELECT 'PASS Global foreign-currency expense conversion, immutable FX snapshot/history, base-currency compatibility and idempotency' AS result;
