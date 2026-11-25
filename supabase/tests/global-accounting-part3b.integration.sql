\set ON_ERROR_STOP on
-- Part 3B integration fixtures: synthetic Global workspace only.
SET ROLE service_role;
INSERT INTO global.workspaces(id,name,country_code,locale_code,currency_code,created_by)
VALUES ('77777777-7777-4777-8777-777777777777','Part 3B FX Accounting Test','GB','en-GB','GBP','66666666-6666-4666-8666-666666666666');
INSERT INTO global.workspace_members(workspace_id,user_id,role,status)
VALUES
 ('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','owner','active'),
 ('77777777-7777-4777-8777-777777777777','b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','accountant','active'),
 ('77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888','manager','active');
INSERT INTO global.products(id,workspace_id,name,sku,unit,sale_price_minor,purchase_cost_minor,currency_code,created_by)
VALUES ('77777777-aaaa-4777-8777-777777777777','77777777-7777-4777-8777-777777777777',
 'FX Purchase Test Product','P3B-001','unit',2500,800,'GBP','66666666-6666-4666-8666-666666666666');
RESET ROLE;

DO $purchase_workflow$
DECLARE
  created jsonb; duplicate_create jsonb; posted jsonb; payment jsonb; duplicate_payment jsonb;
  conflict_payment jsonb; revalued jsonb; duplicate_revaluation jsonb; conflict_revaluation jsonb;
  denied jsonb; bill_id uuid; supplier_id uuid; payment_id uuid; stock_qty numeric;
  j_count integer; v_base_outstanding bigint; v_amount_paid bigint; v_status text;
BEGIN
  created:=public.global_create_purchase_bill(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','77777777-7777-4777-8777-777777777777',
    'Acme Components','ap@acme.example','GB-TAX-TEST','ACME-INV-77','2026-11-16','2026-12-16','USD',
    2000,200,200,1600,160,160,4,5,'2026-11-16','ECB test fixture rate 0.80',
    jsonb_build_array(jsonb_build_object('product_id','77777777-aaaa-4777-8777-777777777777',
      'quantity',2,'unit_cost_minor',1000,'line_total_minor',2000,'base_line_total_minor',1600,'description','Two test units')),
    'FX inventory purchase','b1111111-1111-4111-8111-111111111111'
  );
  IF created->>'ok'<>'true' OR created->>'duplicate'<>'false' THEN RAISE EXCEPTION 'Purchase bill creation failed: %',created; END IF;
  bill_id:=(created->'purchase_bill'->>'id')::uuid;
  supplier_id:=(created->'supplier'->>'id')::uuid;
  duplicate_create:=public.global_create_purchase_bill(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','77777777-7777-4777-8777-777777777777',
    'Acme Components','ap@acme.example','GB-TAX-TEST','ACME-INV-77','2026-11-16','2026-12-16','USD',
    2000,200,200,1600,160,160,4,5,'2026-11-16','ECB test fixture rate 0.80',
    jsonb_build_array(jsonb_build_object('product_id','77777777-aaaa-4777-8777-777777777777',
      'quantity',2,'unit_cost_minor',1000,'line_total_minor',2000,'base_line_total_minor',1600,'description','Two test units')),
    'FX inventory purchase','b1111111-1111-4111-8111-111111111111'
  );
  IF duplicate_create->>'ok'<>'true' OR duplicate_create->>'duplicate'<>'true' THEN RAISE EXCEPTION 'Purchase create retry was not idempotent: %',duplicate_create; END IF;

  denied:=public.global_post_purchase_bill('88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777',bill_id);
  IF denied->>'reason'<>'forbidden' THEN RAISE EXCEPTION 'Manager posted a purchase bill: %',denied; END IF;
  posted:=public.global_post_purchase_bill('b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','77777777-7777-4777-8777-777777777777',bill_id);
  IF posted->>'ok'<>'true' OR posted->'purchase_bill'->>'base_outstanding_minor'<>'1760' THEN
    RAISE EXCEPTION 'Purchase bill did not post with the correct base liability: %',posted;
  END IF;
  SELECT quantity INTO stock_qty FROM global.stock_levels
  WHERE workspace_id='77777777-7777-4777-8777-777777777777' AND product_id='77777777-aaaa-4777-8777-777777777777';
  IF stock_qty<>2 THEN RAISE EXCEPTION 'Purchase posting did not receive stock exactly once: %',stock_qty; END IF;
  IF (SELECT count(*) FROM global.stock_movements WHERE reference_type='purchase_bill' AND reference_id=bill_id)<>1 THEN
    RAISE EXCEPTION 'Purchase stock movement was not recorded exactly once';
  END IF;

  payment:=public.global_record_purchase_payment(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','77777777-7777-4777-8777-777777777777',bill_id,
    1100,'USD',825,3,4,'2026-11-20','ECB test fixture rate 0.75','2026-11-20','Bank','PAY-USD-1',
    'c1111111-1111-4111-8111-111111111111'
  );
  IF payment->>'ok'<>'true' OR payment->'payment'->>'base_liability_settled_minor'<>'880' THEN
    RAISE EXCEPTION 'Foreign-currency supplier payment failed or carrying value is wrong: %',payment;
  END IF;
  payment_id:=(payment->'payment'->>'id')::uuid;
  duplicate_payment:=public.global_record_purchase_payment(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','77777777-7777-4777-8777-777777777777',bill_id,
    1100,'USD',825,3,4,'2026-11-20','ECB test fixture rate 0.75','2026-11-20','Bank','PAY-USD-1',
    'c1111111-1111-4111-8111-111111111111'
  );
  IF duplicate_payment->>'ok'<>'true' OR duplicate_payment->>'duplicate'<>'true' THEN RAISE EXCEPTION 'Purchase payment retry failed: %',duplicate_payment; END IF;
  conflict_payment:=public.global_record_purchase_payment(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','77777777-7777-4777-8777-777777777777',bill_id,
    1100,'USD',826,3,4,'2026-11-20','ECB test fixture rate 0.75','2026-11-20','Bank','PAY-USD-1',
    'c1111111-1111-4111-8111-111111111111'
  );
  IF conflict_payment->>'reason'<>'idempotency_conflict' THEN RAISE EXCEPTION 'Conflicting purchase payment retry was accepted: %',conflict_payment; END IF;

  revalued:=public.global_revalue_purchase_bill(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','77777777-7777-4777-8777-777777777777',bill_id,
    '2026-11-30',17,20,'ECB month-end test fixture 0.85','d1111111-1111-4111-8111-111111111111'
  );
  IF revalued->>'ok'<>'true' OR revalued->>'fx_delta_minor'<>'55'
    OR revalued->'purchase_bill'->>'base_outstanding_minor'<>'935' THEN
    RAISE EXCEPTION 'Unrealized FX revaluation failed: %',revalued;
  END IF;
  duplicate_revaluation:=public.global_revalue_purchase_bill(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','77777777-7777-4777-8777-777777777777',bill_id,
    '2026-11-30',17,20,'ECB month-end test fixture 0.85','d1111111-1111-4111-8111-111111111111'
  );
  IF duplicate_revaluation->>'ok'<>'true' OR duplicate_revaluation->>'duplicate'<>'true' THEN RAISE EXCEPTION 'FX revaluation retry failed: %',duplicate_revaluation; END IF;
  conflict_revaluation:=public.global_revalue_purchase_bill(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','77777777-7777-4777-8777-777777777777',bill_id,
    '2026-11-30',18,20,'Different rate','d1111111-1111-4111-8111-111111111111'
  );
  IF conflict_revaluation->>'reason'<>'idempotency_conflict' THEN RAISE EXCEPTION 'Conflicting FX revaluation retry was accepted: %',conflict_revaluation; END IF;

  payment:=public.global_record_purchase_payment(
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','77777777-7777-4777-8777-777777777777',bill_id,
    1100,'USD',990,9,10,'2026-12-01','ECB test fixture rate 0.90','2026-12-01','Bank','PAY-USD-2',
    'e1111111-1111-4111-8111-111111111111'
  );
  IF payment->>'ok'<>'true' OR payment->'purchase_bill'->>'status'<>'paid'
    OR payment->'purchase_bill'->>'base_outstanding_minor'<>'0' THEN
    RAISE EXCEPTION 'Final supplier payment did not close payable: %',payment;
  END IF;

  SELECT count(*) INTO j_count FROM global.journal_entries
  WHERE workspace_id='77777777-7777-4777-8777-777777777777'
    AND source_type IN ('purchase','purchase_payment','fx_revaluation');
  IF j_count<>4 THEN RAISE EXCEPTION 'Expected purchase, two payments and one revaluation journal, found %',j_count; END IF;
  IF (SELECT count(*) FROM global.journal_entries e JOIN global.journal_entry_lines l
      ON l.workspace_id=e.workspace_id AND l.journal_entry_id=e.id
      WHERE e.workspace_id='77777777-7777-4777-8777-777777777777'
      GROUP BY e.id HAVING sum(l.debit_minor)<>sum(l.credit_minor))>0 THEN
    RAISE EXCEPTION 'A Part 3B journal is not balanced';
  END IF;
  IF (SELECT count(*) FROM global.journal_entries e JOIN global.journal_entry_lines l
      ON l.workspace_id=e.workspace_id AND l.journal_entry_id=e.id
      JOIN global.accounting_accounts a ON a.workspace_id=l.workspace_id AND a.id=l.account_id
      WHERE e.workspace_id='77777777-7777-4777-8777-777777777777'
      AND ((e.source_type='purchase_payment' AND a.code='4200' AND l.credit_minor=55)
        OR (e.source_type='fx_revaluation' AND a.code='6200' AND l.debit_minor=55)
        OR (e.source_type='purchase_payment' AND a.code='6200' AND l.debit_minor=55)))<>3 THEN
    RAISE EXCEPTION 'Realized/unrealized FX gain/loss journals are missing or incorrect';
  END IF;

  BEGIN UPDATE global.purchase_bills SET supplier_invoice_number='TAMPERED' WHERE id=bill_id;
    RAISE EXCEPTION 'Posted purchase bill was mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN UPDATE global.purchase_bill_lines SET quantity=9 WHERE purchase_bill_id=bill_id;
    RAISE EXCEPTION 'Posted purchase lines were mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN UPDATE global.purchase_bill_payments SET amount_minor=1 WHERE id=payment_id;
    RAISE EXCEPTION 'Purchase payment was mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END
$purchase_workflow$;

-- Issued invoice refunds automatically reverse revenue and the proportional tax component.
SET ROLE service_role;
INSERT INTO global.invoices(workspace_id,invoice_number,status,currency_code,issue_date,subtotal_minor,discount_minor,tax_minor,total_minor,created_by)
VALUES ('77777777-7777-4777-8777-777777777777','P3B-REFUND-1','draft','GBP','2026-11-16',1000,0,200,1200,
 '66666666-6666-4666-8666-666666666666');
UPDATE global.invoices SET status='issued' WHERE workspace_id='77777777-7777-4777-8777-777777777777' AND invoice_number='P3B-REFUND-1';
INSERT INTO global.invoice_payments(workspace_id,invoice_id,amount_minor,currency_code,payment_date,method,reference,recorded_by,idempotency_key)
SELECT workspace_id,id,1200,'GBP','2026-11-17','Bank','P3B-PAY-1',
 '66666666-6666-4666-8666-666666666666','f1111111-1111-4111-8111-111111111111'
FROM global.invoices WHERE workspace_id='77777777-7777-4777-8777-777777777777' AND invoice_number='P3B-REFUND-1';
UPDATE global.invoices SET amount_paid_minor=1200,status='paid'
WHERE workspace_id='77777777-7777-4777-8777-777777777777' AND invoice_number='P3B-REFUND-1';
INSERT INTO global.invoice_refunds(workspace_id,invoice_id,amount_minor,currency_code,refund_date,method,reference,reason,recorded_by,idempotency_key)
SELECT workspace_id,id,600,'GBP','2026-11-18','Bank','P3B-REF-1','Customer return',
 '66666666-6666-4666-8666-666666666666','f2222222-2222-4222-8222-222222222222'
FROM global.invoices WHERE workspace_id='77777777-7777-4777-8777-777777777777' AND invoice_number='P3B-REFUND-1';
UPDATE global.invoices SET amount_refunded_minor=600,status='partially_refunded'
WHERE workspace_id='77777777-7777-4777-8777-777777777777' AND invoice_number='P3B-REFUND-1';
RESET ROLE;

DO $refund_assertions$
DECLARE v_invoice uuid; v_count int;
BEGIN
  SELECT id INTO v_invoice FROM global.invoices WHERE workspace_id='77777777-7777-4777-8777-777777777777' AND invoice_number='P3B-REFUND-1';
  IF (SELECT count(*) FROM global.journal_entries WHERE workspace_id='77777777-7777-4777-8777-777777777777' AND source_type='invoice_refund')<>1 THEN
    RAISE EXCEPTION 'Refund did not create exactly one accounting journal';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM global.journal_entries e JOIN global.journal_entry_lines l ON l.workspace_id=e.workspace_id AND l.journal_entry_id=e.id
    JOIN global.accounting_accounts a ON a.workspace_id=l.workspace_id AND a.id=l.account_id
    WHERE e.workspace_id='77777777-7777-4777-8777-777777777777' AND e.source_type='invoice_refund'
      AND a.code='4050' AND l.debit_minor=500)
    OR NOT EXISTS(SELECT 1 FROM global.journal_entries e JOIN global.journal_entry_lines l ON l.workspace_id=e.workspace_id AND l.journal_entry_id=e.id
      JOIN global.accounting_accounts a ON a.workspace_id=l.workspace_id AND a.id=l.account_id
      WHERE e.workspace_id='77777777-7777-4777-8777-777777777777' AND e.source_type='invoice_refund'
      AND a.code='2100' AND l.debit_minor=100) THEN
    RAISE EXCEPTION 'Refund revenue/tax allocation was incorrect';
  END IF;
  SELECT count(*) INTO v_count FROM global.journal_entries e JOIN global.journal_entry_lines l
    ON l.workspace_id=e.workspace_id AND l.journal_entry_id=e.id
    WHERE e.workspace_id='77777777-7777-4777-8777-777777777777'
    GROUP BY e.id HAVING sum(l.debit_minor)<>sum(l.credit_minor);
  IF v_count>0 THEN RAISE EXCEPTION 'Refund journal is not balanced'; END IF;
END
$refund_assertions$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',false);
DO $member_read$
DECLARE v_result jsonb;
BEGIN
  v_result:=public.global_list_purchase_bills('66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777',20);
  IF v_result->>'ok'<>'true' OR jsonb_array_length(v_result->'purchase_bills')<>1
    OR v_result->'purchase_bills'->0->>'supplier_name'<>'Acme Components' THEN
    RAISE EXCEPTION 'Member-scoped purchase listing failed: %',v_result;
  END IF;
  BEGIN
    PERFORM public.global_list_purchase_bills('77777777-7777-4777-8777-777777777777','77777777-7777-4777-8777-777777777777',20);
    RAISE EXCEPTION 'Purchase list accepted a spoofed user id';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.global_list_purchase_bills('66666666-6666-4666-8666-666666666666','dddddddd-dddd-4ddd-8ddd-dddddddddddd',20);
    RAISE EXCEPTION 'Cross-workspace purchase list was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$member_read$;
RESET ROLE;

DO $accounting_part3b_grants$
BEGIN
  IF has_function_privilege('anon','public.global_create_purchase_bill(uuid,uuid,text,text,text,text,date,date,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,date,text,jsonb,text,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.global_create_purchase_bill(uuid,uuid,text,text,text,text,date,date,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,date,text,jsonb,text,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.global_create_purchase_bill(uuid,uuid,text,text,text,text,date,date,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,date,text,jsonb,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Purchase write RPC is not service-role-only';
  END IF;
  IF NOT has_function_privilege('authenticated','public.global_list_purchase_bills(uuid,uuid,integer)','EXECUTE')
    OR has_table_privilege('authenticated','global.purchase_bills','INSERT')
    OR has_table_privilege('authenticated','global.purchase_bill_payments','UPDATE') THEN
    RAISE EXCEPTION 'Purchase read/write grants are not least-privilege';
  END IF;
END
$accounting_part3b_grants$;

SELECT 'PASS: FX-aware purchase bills/payments, realized and unrealized FX, inventory receipt, refund revenue/tax reversals, idempotency, immutability and tenant isolation' AS result;
