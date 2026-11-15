\set ON_ERROR_STOP on
-- Runs in the disposable candidate database after global-business-data.integration.sql.
SET ROLE service_role;
DO $global_invoice_ledger$
DECLARE
  draft jsonb;
  draft_retry jsonb;
  draft_conflict jsonb;
  draft_key uuid := '99999999-eeee-4999-8999-999999999999';
  denied jsonb;
  payment jsonb;
  duplicate_payment jsonb;
  conflict_payment jsonb;
  overpayment jsonb;
  v_invoice_id uuid := '55555555-eeee-4555-8555-555555555555';
  idem uuid := '66666666-eeee-4666-8666-666666666666';
  payment_count bigint;
  invoice_row global.invoices%rowtype;
BEGIN
  draft := public.global_create_invoice_draft(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'GBP','2026-11-15',NULL,'draft-only integration fixture',
    jsonb_build_array(jsonb_build_object(
      'product_id','11111111-aaaa-4111-8111-111111111111',
      'description','Draft line','quantity',2,'unit_price_minor',5000,'discount_minor',500
    )),
    draft_key
  );
  IF draft->>'ok' <> 'true'
    OR draft->'invoice'->>'status' <> 'draft'
    OR (draft->'invoice'->>'subtotal_minor')::bigint <> 10000
    OR (draft->'invoice'->>'discount_minor')::bigint <> 500
    OR (draft->'invoice'->>'tax_minor')::bigint <> 0
    OR (draft->'invoice'->>'total_minor')::bigint <> 9500
    OR draft->'invoice'->'invoice_snapshot'->>'tax_status' <> 'not_calculated' THEN
    RAISE EXCEPTION 'Global draft invoice calculation or draft-only tax snapshot failed: %', draft;
  END IF;

  draft_retry := public.global_create_invoice_draft(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'GBP','2026-11-15',NULL,'draft-only integration fixture',
    jsonb_build_array(jsonb_build_object(
      'product_id','11111111-aaaa-4111-8111-111111111111',
      'description','Draft line','quantity',2,'unit_price_minor',5000,'discount_minor',500
    )),draft_key
  );
  IF draft_retry->>'ok'<>'true' OR draft_retry->>'duplicate'<>'true'
    OR draft_retry->'invoice'->>'id'<>draft->'invoice'->>'id' THEN
    RAISE EXCEPTION 'Global draft invoice retry was not idempotent: %', draft_retry;
  END IF;
  draft_conflict := public.global_create_invoice_draft(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'GBP','2026-11-15',NULL,'draft-only integration fixture',
    jsonb_build_array(jsonb_build_object(
      'product_id','11111111-aaaa-4111-8111-111111111111',
      'description','Different draft line','quantity',2,'unit_price_minor',5000,'discount_minor',500
    )),draft_key
  );
  IF draft_conflict->>'reason'<>'idempotency_conflict' THEN
    RAISE EXCEPTION 'Global draft invoice idempotency conflict was not rejected: %', draft_conflict;
  END IF;

  denied := public.global_create_invoice_draft(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    NULL,'GBP','2026-11-15',NULL,NULL,
    jsonb_build_array(jsonb_build_object('description','Denied','quantity',1,'unit_price_minor',100)),
    'aaaaaaaa-eeee-4aaa-8aaa-aaaaaaaaaaaa'
  );
  IF denied->>'reason' <> 'forbidden' THEN RAISE EXCEPTION 'Accountant created invoice draft: %', denied; END IF;

  INSERT INTO global.invoices(id,workspace_id,client_id,invoice_number,status,currency_code,issue_date,total_minor,created_by)
  VALUES(v_invoice_id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'ISSUED-PAYMENT-TEST','issued','GBP','2026-11-15',10000,'66666666-6666-4666-8666-666666666666');

  payment := public.global_record_invoice_payment(
    '66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_invoice_id,3000,'GBP','2026-11-15','bank_transfer','BANK-REF-1','first payment',idem
  );
  IF payment->>'ok'<>'true' OR payment->>'duplicate'<>'false'
    OR payment->'invoice'->>'status'<>'partially_paid'
    OR (payment->'invoice'->>'amount_paid_minor')::bigint<>3000 THEN
    RAISE EXCEPTION 'Global invoice payment recording failed: %', payment;
  END IF;

  duplicate_payment := public.global_record_invoice_payment(
    '66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_invoice_id,3000,'GBP','2026-11-15','bank_transfer','BANK-REF-1','first payment',idem
  );
  IF duplicate_payment->>'ok'<>'true' OR duplicate_payment->>'duplicate'<>'true' THEN
    RAISE EXCEPTION 'Global payment retry was not idempotent: %', duplicate_payment;
  END IF;

  conflict_payment := public.global_record_invoice_payment(
    '66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_invoice_id,4000,'GBP','2026-11-15','bank_transfer','BANK-REF-1','first payment',idem
  );
  IF conflict_payment->>'reason'<>'idempotency_conflict' THEN
    RAISE EXCEPTION 'Global payment idempotency conflict was not rejected: %', conflict_payment;
  END IF;

  overpayment := public.global_record_invoice_payment(
    '66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_invoice_id,8000,'GBP','2026-11-15','bank_transfer','BANK-REF-2','overpayment attempt',
    '77777777-eeee-4777-8777-777777777777'
  );
  IF overpayment->>'reason'<>'overpayment' THEN
    RAISE EXCEPTION 'Global overpayment was not rejected: %', overpayment;
  END IF;

  SELECT count(*) INTO payment_count FROM global.invoice_payments WHERE invoice_id=v_invoice_id;
  IF payment_count<>1 THEN RAISE EXCEPTION 'Payment retry created duplicate ledger rows: %',payment_count; END IF;
  SELECT * INTO invoice_row FROM global.invoices WHERE id=v_invoice_id;
  IF invoice_row.amount_paid_minor<>3000 OR invoice_row.status<>'partially_paid' THEN
    RAISE EXCEPTION 'Invoice payment balance is inconsistent: %',row_to_json(invoice_row);
  END IF;
END
$global_invoice_ledger$;
RESET ROLE;

SET ROLE authenticated;
DO $rpc_privileges$
BEGIN
  IF has_function_privilege('authenticated','public.global_create_invoice_draft(uuid,uuid,uuid,text,date,date,text,jsonb,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.global_record_invoice_payment(uuid,uuid,uuid,bigint,text,date,text,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated role can execute Global invoice/payment RPCs directly';
  END IF;
END
$rpc_privileges$;
RESET ROLE;

SELECT 'PASS Global draft invoice arithmetic, role checks, external payment ledger, idempotent retry, conflict and overpayment rejection' AS result;
