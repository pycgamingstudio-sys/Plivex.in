\set ON_ERROR_STOP on
-- Synthetic accounting fixtures run only against the disposable migration replay database.
SET ROLE service_role;
INSERT INTO global.workspaces(id,name,country_code,locale_code,currency_code,created_by)
VALUES ('99999999-aaaa-4999-8999-999999999999','Accounting Test Workspace','GB','en-GB','GBP','66666666-6666-4666-8666-666666666666');
INSERT INTO global.workspace_members(workspace_id,user_id,role,status)
VALUES
 ('99999999-aaaa-4999-8999-999999999999','66666666-6666-4666-8666-666666666666','owner','active'),
 ('99999999-aaaa-4999-8999-999999999999','b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','accountant','active'),
 ('99999999-aaaa-4999-8999-999999999999','88888888-8888-4888-8888-888888888888','manager','active');
DO $accounting_engine$
DECLARE
  posted jsonb; retry jsonb; conflict_result jsonb; unbalanced jsonb; denied jsonb;
  wrong_currency jsonb; bad_account jsonb; entry_id uuid; entry_count bigint;
BEGIN
  IF (SELECT count(*) FROM global.accounting_accounts WHERE workspace_id='99999999-aaaa-4999-8999-999999999999') < 13 THEN
    RAISE EXCEPTION 'Default chart of accounts was not seeded for new workspace';
  END IF;
  posted := public.global_post_journal_entry(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','99999999-aaaa-4999-8999-999999999999',
    '2026-11-16','GBP','Test sales receipt','manual',NULL,
    jsonb_build_array(
      jsonb_build_object('account_code','1000','debit_minor',5000,'credit_minor',0,'description','Cash received'),
      jsonb_build_object('account_code','4000','debit_minor',0,'credit_minor',5000,'description','Sales')
    ),'a1111111-1111-4111-8111-111111111111');
  IF posted->>'ok'<>'true' OR posted->>'duplicate'<>'false' THEN RAISE EXCEPTION 'Balanced journal entry failed: %',posted; END IF;
  entry_id := (posted->'entry'->>'id')::uuid;
  retry := public.global_post_journal_entry(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','99999999-aaaa-4999-8999-999999999999',
    '2026-11-16','GBP','Test sales receipt','manual',NULL,
    jsonb_build_array(
      jsonb_build_object('account_code','1000','debit_minor',5000,'credit_minor',0,'description','Cash received'),
      jsonb_build_object('account_code','4000','debit_minor',0,'credit_minor',5000,'description','Sales')
    ),'a1111111-1111-4111-8111-111111111111');
  IF retry->>'ok'<>'true' OR retry->>'duplicate'<>'true' OR retry->'entry'->>'id'<>entry_id::text THEN RAISE EXCEPTION 'Journal retry was not idempotent: %',retry; END IF;
  conflict_result := public.global_post_journal_entry(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','99999999-aaaa-4999-8999-999999999999',
    '2026-11-16','GBP','Changed memo','manual',NULL,
    jsonb_build_array(
      jsonb_build_object('account_code','1000','debit_minor',5000,'credit_minor',0),
      jsonb_build_object('account_code','4000','debit_minor',0,'credit_minor',5000)
    ),'a1111111-1111-4111-8111-111111111111');
  IF conflict_result->>'reason'<>'idempotency_conflict' THEN RAISE EXCEPTION 'Conflicting retry was accepted: %',conflict_result; END IF;
  unbalanced := public.global_post_journal_entry(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','99999999-aaaa-4999-8999-999999999999',
    '2026-11-16','GBP','Unbalanced','manual',NULL,
    jsonb_build_array(
      jsonb_build_object('account_code','1000','debit_minor',5000,'credit_minor',0),
      jsonb_build_object('account_code','4000','debit_minor',0,'credit_minor',4999)
    ),'a2222222-2222-4222-8222-222222222222');
  IF unbalanced->>'reason'<>'unbalanced_journal' THEN RAISE EXCEPTION 'Unbalanced journal was accepted: %',unbalanced; END IF;
  wrong_currency := public.global_post_journal_entry(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','99999999-aaaa-4999-8999-999999999999',
    '2026-11-16','USD','Wrong currency','manual',NULL,
    jsonb_build_array(
      jsonb_build_object('account_code','1000','debit_minor',100,'credit_minor',0),
      jsonb_build_object('account_code','4000','debit_minor',0,'credit_minor',100)
    ),'a3333333-3333-4333-8333-333333333333');
  IF wrong_currency->>'reason'<>'currency_mismatch' THEN RAISE EXCEPTION 'Foreign currency journal was accepted: %',wrong_currency; END IF;
  bad_account := public.global_post_journal_entry(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','99999999-aaaa-4999-8999-999999999999',
    '2026-11-16','GBP','Unknown account','manual',NULL,
    jsonb_build_array(
      jsonb_build_object('account_code','9999','debit_minor',100,'credit_minor',0),
      jsonb_build_object('account_code','4000','debit_minor',0,'credit_minor',100)
    ),'a4444444-4444-4444-8444-444444444444');
  IF bad_account->>'reason'<>'account_not_found' THEN RAISE EXCEPTION 'Unknown account was accepted: %',bad_account; END IF;
  denied := public.global_post_journal_entry(
    '88888888-8888-4888-8888-888888888888','99999999-aaaa-4999-8999-999999999999',
    '2026-11-16','GBP','Manager denied','manual',NULL,
    jsonb_build_array(
      jsonb_build_object('account_code','1000','debit_minor',100,'credit_minor',0),
      jsonb_build_object('account_code','4000','debit_minor',0,'credit_minor',100)
    ),'a5555555-5555-4555-8555-555555555555');
  IF denied->>'reason'<>'forbidden' THEN RAISE EXCEPTION 'Manager posted a manual journal: %',denied; END IF;
  denied := public.global_post_journal_entry(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '2026-11-16','USD','Cross workspace','manual',NULL,
    jsonb_build_array(
      jsonb_build_object('account_code','1000','debit_minor',100,'credit_minor',0),
      jsonb_build_object('account_code','4000','debit_minor',0,'credit_minor',100)
    ),'a6666666-6666-4666-8666-666666666666');
  IF denied->>'reason'<>'access_denied' THEN RAISE EXCEPTION 'Cross-workspace posting was allowed: %',denied; END IF;
  SELECT count(*) INTO entry_count FROM global.journal_entries WHERE workspace_id='99999999-aaaa-4999-8999-999999999999';
  IF entry_count<>1 THEN RAISE EXCEPTION 'Rejected or duplicate requests created journal rows: %',entry_count; END IF;
  BEGIN UPDATE global.journal_entries SET memo='tampered' WHERE id=entry_id; RAISE EXCEPTION 'Journal header was mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN DELETE FROM global.journal_entry_lines WHERE journal_entry_id=entry_id; RAISE EXCEPTION 'Journal lines were mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END
$accounting_engine$;
RESET ROLE;

DO $source_journals$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM global.journal_entries WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND source_type='expense') THEN
    RAISE EXCEPTION 'Global expense creation did not create its accounting journal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM global.journal_entries WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND source_type='invoice_issued') THEN
    RAISE EXCEPTION 'Global invoice issuance did not create its accounting journal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM global.journal_entries WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND source_type='invoice_payment') THEN
    RAISE EXCEPTION 'Global invoice payment did not create its accounting journal';
  END IF;
END
$source_journals$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',false);
DO $accounting_reports$
DECLARE trial jsonb; ledger jsonb; statements jsonb;
BEGIN
  trial := public.global_get_trial_balance('99999999-aaaa-4999-8999-999999999999','2026-11-01','2026-11-30','GBP');
  IF trial->>'total_debit_minor'<>'5000' OR trial->>'total_credit_minor'<>'5000'
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(trial->'accounts') a WHERE a->>'code'='1000' AND a->>'net_debit_minor'='5000') THEN
    RAISE EXCEPTION 'Trial balance totals are wrong: %',trial;
  END IF;
  ledger := public.global_get_general_ledger('99999999-aaaa-4999-8999-999999999999','1000','2026-11-01','2026-11-30','GBP');
  IF jsonb_array_length(ledger->'entries')<>1 OR ledger->'entries'->0->>'running_debit_minor'<>'5000' THEN
    RAISE EXCEPTION 'General ledger detail is wrong: %',ledger;
  END IF;
  statements := public.global_get_financial_statements('99999999-aaaa-4999-8999-999999999999','2026-11-01','2026-11-30','GBP');
  IF statements->'income_statement'->>'revenue_minor'<>'5000'
    OR statements->'income_statement'->>'expenses_minor'<>'0'
    OR statements->'balance_sheet'->>'assets_minor'<>'5000'
    OR statements->'balance_sheet'->>'unclosed_earnings_minor'<>'5000'
    OR statements->'balance_sheet'->>'balanced'<>'true' THEN
    RAISE EXCEPTION 'Financial statements are inconsistent: %',statements;
  END IF;
  BEGIN
    PERFORM public.global_get_trial_balance('dddddddd-dddd-4ddd-8ddd-dddddddddddd',NULL,NULL,'USD');
    RAISE EXCEPTION 'Cross-workspace accounting report was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$accounting_reports$;
RESET ROLE;

DO $accounting_privileges$
BEGIN
  IF has_function_privilege('anon','public.global_post_journal_entry(uuid,uuid,date,text,text,text,uuid,jsonb,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.global_post_journal_entry(uuid,uuid,date,text,text,text,uuid,jsonb,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.global_post_journal_entry(uuid,uuid,date,text,text,text,uuid,jsonb,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Journal posting RPC is not service-role-only';
  END IF;
  IF NOT has_function_privilege('authenticated','public.global_get_trial_balance(uuid,date,date,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.global_get_general_ledger(uuid,text,date,date,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.global_get_financial_statements(uuid,date,date,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Accounting read reports are not granted to authenticated members';
  END IF;
  IF has_table_privilege('authenticated','global.journal_entries','INSERT')
    OR has_table_privilege('authenticated','global.journal_entry_lines','UPDATE') THEN
    RAISE EXCEPTION 'Authenticated role can directly mutate accounting records';
  END IF;
END
$accounting_privileges$;

SELECT 'PASS: balanced immutable journals, automatic invoice/payment/expense posting, idempotency, isolation, trial balance, general ledger, income statement and balance sheet' AS result;
