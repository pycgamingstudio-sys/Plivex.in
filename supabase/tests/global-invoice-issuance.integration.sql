\set ON_ERROR_STOP on
-- Runs after Global business-data and invoice-ledger fixtures in disposable PostgreSQL only.
SET ROLE service_role;
DO $global_invoice_issuance$
DECLARE
  v_draft jsonb;
  v_issued jsonb;
  v_retry jsonb;
  v_payment jsonb;
  v_refund jsonb;
  v_refund_retry jsonb;
  v_reconciliation jsonb;
  v_us_draft jsonb;
  v_us_issue jsonb;
  v_discounted_draft jsonb;
  v_discounted_issue jsonb;
  v_discounted_invoice_id uuid;
  v_reduced_draft jsonb;
  v_reduced_issue jsonb;
  v_reduced_invoice_id uuid;
  v_reverse_draft jsonb;
  v_reverse_issue jsonb;
  v_reverse_invoice_id uuid;
  v_invoice_id uuid;
  v_payment_id uuid;
  v_invoice global.invoices%rowtype;
  v_line global.invoice_items%rowtype;
  v_rejected boolean;
  v_issue_key uuid := 'a1111111-1111-4111-8111-111111111111';
  v_payment_key uuid := 'a2222222-2222-4222-8222-222222222222';
  v_refund_key uuid := 'a3333333-3333-4333-8333-333333333333';
BEGIN
  UPDATE global.business_profiles
  SET legal_name='Workspace A Ltd',display_name='Workspace A',address='10 Example Street',
      tax_registration_number='GB123456789',tax_registration_type='VAT',
      tax_registration_status='registered',tax_registration_effective_from='2026-01-01'
  WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  v_draft := public.global_create_invoice_draft(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'GBP','2026-11-15','2026-12-15','Part 5 GB VAT issue test',
    jsonb_build_array(jsonb_build_object(
      'description','Global invoice test item','quantity',2,'unit_price_minor',5000,'discount_minor',0
    )),
    'a0000000-0000-4000-8000-000000000001'
  );
  IF v_draft->>'ok'<>'true' OR v_draft->'invoice'->>'status'<>'draft' THEN
    RAISE EXCEPTION 'Could not create Global draft for issuance test: %',v_draft;
  END IF;
  v_invoice_id := (v_draft->'invoice'->>'id')::uuid;

  v_issued := public.global_issue_invoice(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_invoice_id,
    '{"registration_confirmed":true,"place_of_supply_confirmed":true,"tax_category_confirmed":true,"tax_category":"standard-rated","mode":"automatic","price_mode":"exclusive","place_of_supply":"United Kingdom"}'::jsonb,
    v_issue_key
  );
  IF v_issued->>'ok'<>'true' OR v_issued->'invoice'->>'status'<>'issued'
    OR v_issued->'invoice'->>'invoice_number'<>'INV-GB-2026-000001'
    OR (v_issued->'invoice'->>'tax_minor')::bigint<>2000
    OR (v_issued->'invoice'->>'total_minor')::bigint<>12000
    OR v_issued->'invoice'->'invoice_snapshot'->>'tax_status'<>'calculated'
    OR v_issued->'invoice'->'invoice_snapshot'->'seller'->>'tax_registration_number'<>'GB123456789'
    OR v_issued->'invoice'->'invoice_snapshot'->'buyer'->>'name'<>'Client A' THEN
    RAISE EXCEPTION 'GB invoice issuance, numbering or immutable VAT snapshot failed: %',v_issued;
  END IF;

  v_retry := public.global_issue_invoice(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_invoice_id,
    '{"registration_confirmed":true,"place_of_supply_confirmed":true,"tax_category_confirmed":true,"tax_category":"standard-rated","mode":"automatic","price_mode":"exclusive","place_of_supply":"United Kingdom"}'::jsonb,
    v_issue_key
  );
  IF v_retry->>'ok'<>'true' OR v_retry->>'duplicate'<>'true'
    OR v_retry->'invoice'->>'id'<>v_invoice_id::text THEN
    RAISE EXCEPTION 'Global invoice issuance retry was not idempotent: %',v_retry;
  END IF;

  v_retry := public.global_issue_invoice(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_invoice_id,
    '{"registration_confirmed":true,"place_of_supply_confirmed":true,"tax_category_confirmed":true,"tax_category":"standard-rated","mode":"automatic","price_mode":"inclusive","place_of_supply":"United Kingdom"}'::jsonb,
    v_issue_key
  );
  IF v_retry->>'ok'<>'false' OR v_retry->>'reason'<>'idempotency_conflict' THEN
    RAISE EXCEPTION 'Issuance idempotency key accepted a changed tax context: %',v_retry;
  END IF;

  SELECT * INTO v_line FROM global.invoice_items WHERE invoice_id=v_invoice_id LIMIT 1;
  IF v_line.tax_rate_bps<>2000 OR v_line.tax_minor<>2000 OR v_line.line_total_minor<>12000 THEN
    RAISE EXCEPTION 'GB invoice line VAT values are inconsistent: %',row_to_json(v_line);
  END IF;

  -- Line discounts are already netted by draft creation. Issuance must tax
  -- each discounted line once, not tax gross lines or apply the discount twice.
  v_discounted_draft := public.global_create_invoice_draft(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'GBP','2026-11-15','2026-12-15','Discounted line VAT test',
    jsonb_build_array(
      jsonb_build_object('description','Line one','quantity',1,'unit_price_minor',10000,'discount_minor',1000),
      jsonb_build_object('description','Line two','quantity',1,'unit_price_minor',20000,'discount_minor',3000)
    ),
    'a0000000-0000-4000-8000-000000000003'
  );
  IF v_discounted_draft->>'ok'<>'true'
    OR (v_discounted_draft->'invoice'->>'subtotal_minor')::bigint<>30000
    OR (v_discounted_draft->'invoice'->>'discount_minor')::bigint<>4000
    OR (v_discounted_draft->'invoice'->>'total_minor')::bigint<>26000 THEN
    RAISE EXCEPTION 'Discounted invoice draft totals are inconsistent: %',v_discounted_draft;
  END IF;
  v_discounted_invoice_id := (v_discounted_draft->'invoice'->>'id')::uuid;
  v_discounted_issue := public.global_issue_invoice(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_discounted_invoice_id,
    '{"registration_confirmed":true,"place_of_supply_confirmed":true,"tax_category_confirmed":true,"tax_category":"standard-rated","mode":"automatic","price_mode":"exclusive","place_of_supply":"United Kingdom"}'::jsonb,
    'a5555555-5555-4555-8555-555555555555'
  );
  IF v_discounted_issue->>'ok'<>'true'
    OR (v_discounted_issue->'invoice'->>'tax_minor')::bigint<>5200
    OR (v_discounted_issue->'invoice'->>'total_minor')::bigint<>31200 THEN
    RAISE EXCEPTION 'Discounted invoice tax was not calculated from net line amounts: %',v_discounted_issue;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM global.invoice_items
    WHERE invoice_id=v_discounted_invoice_id AND description='Line one'
      AND discount_minor=1000 AND tax_minor=1800 AND line_total_minor=10800
  ) OR NOT EXISTS (
    SELECT 1 FROM global.invoice_items
    WHERE invoice_id=v_discounted_invoice_id AND description='Line two'
      AND discount_minor=3000 AND tax_minor=3400 AND line_total_minor=20400
  ) THEN
    RAISE EXCEPTION 'Per-line discounted VAT breakdown is inconsistent';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE global.invoices SET invoice_snapshot='{}'::jsonb WHERE id=v_invoice_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Issued invoice tax snapshot was mutable'; END IF;

  v_rejected := false;
  BEGIN
    UPDATE global.invoice_items SET description='Tampered line' WHERE id=v_line.id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Issued invoice line was mutable'; END IF;

  v_payment := public.global_record_invoice_payment(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_invoice_id,6000,'GBP','2026-11-15','bank_transfer','GB-PAY-1','Part payment',v_payment_key
  );
  IF v_payment->>'ok'<>'true' OR v_payment->'invoice'->>'status'<>'partially_paid' THEN
    RAISE EXCEPTION 'Global issued invoice payment ledger failed: %',v_payment;
  END IF;

  SELECT id INTO v_payment_id FROM global.invoice_payments
  WHERE invoice_id=v_invoice_id ORDER BY created_at DESC LIMIT 1;
  v_rejected := false;
  BEGIN
    UPDATE global.invoice_payments SET method='tampered' WHERE id=v_payment_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Global payment ledger row was mutable'; END IF;

  v_refund := public.global_record_invoice_refund(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_invoice_id,1000,'GBP','2026-11-15','bank_transfer','GB-REF-1','Customer refund',v_refund_key
  );
  IF v_refund->>'ok'<>'true' OR v_refund->'invoice'->>'status'<>'partially_refunded'
    OR (v_refund->'invoice'->>'amount_refunded_minor')::bigint<>1000 THEN
    RAISE EXCEPTION 'Global refund ledger failed: %',v_refund;
  END IF;

  v_refund_retry := public.global_record_invoice_refund(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_invoice_id,1000,'GBP','2026-11-15','bank_transfer','GB-REF-1','Customer refund',v_refund_key
  );
  IF v_refund_retry->>'ok'<>'true' OR v_refund_retry->>'duplicate'<>'true' THEN
    RAISE EXCEPTION 'Global refund retry was not idempotent: %',v_refund_retry;
  END IF;

  v_reconciliation := public.global_list_invoice_reconciliation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',200
  );
  IF v_reconciliation->>'ok'<>'true' OR coalesce(v_reconciliation->>'country_code','')<>'GB'
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_reconciliation->'records') r
      WHERE r->>'invoice_id'=v_invoice_id::text
        AND (r->>'gross_payments_minor')::bigint=6000
        AND (r->>'refunds_minor')::bigint=1000
        AND (r->>'net_received_minor')::bigint=5000
        AND (r->>'outstanding_minor')::bigint=7000
    ) THEN
    RAISE EXCEPTION 'Global payment/refund reconciliation mismatch: %',v_reconciliation;
  END IF;

  UPDATE global.business_profiles
  SET legal_name='US Workspace Ltd',address='100 Main Street, Los Angeles, CA 90012',
      tax_registration_number='CA-TEST-PERMIT',tax_registration_type='SALES TAX PERMIT',
      tax_registration_status='registered',tax_registration_effective_from='2026-01-01',
      tax_jurisdiction_code='US-CA'
  WHERE workspace_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  v_us_draft := public.global_create_invoice_draft(
    '77777777-7777-4777-8777-777777777777',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'USD','2026-11-20',NULL,'US verified jurisdiction test',
    jsonb_build_array(jsonb_build_object('description','US taxable item','quantity',1,'unit_price_minor',10000)),
    'a0000000-0000-4000-8000-000000000002'
  );
  v_us_issue := public.global_issue_invoice(
    '77777777-7777-4777-8777-777777777777',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    (v_us_draft->'invoice'->>'id')::uuid,
    '{"registration_confirmed":true,"place_of_supply_confirmed":true,"tax_category_confirmed":true,"tax_category":"US_STANDARD","mode":"automatic","tax_treatment":"standard","price_mode":"exclusive","place_of_supply":"United States","collection_obligation_attested":true,"jurisdiction_id":"US|CA|LOSANGELES|LOSANGELES|90012","destination_jurisdiction":{"state":"CA","county":"Los Angeles","city":"Los Angeles","postal_code":"90012"}}'::jsonb,
    'a4444444-4444-4444-8444-444444444444'
  );
  IF v_us_issue->>'reason'<>'us_verified_local_rule_unavailable' THEN
    RAISE EXCEPTION 'US issuance did not fail closed when no verified local rule exists: %',v_us_issue;
  END IF;

  INSERT INTO global.tax_rule_versions(
    id,country_code,jurisdiction_id,currency_code,tax_code,version,treatment,
    effective_from,effective_to,reviewed_on,reviewed_by,source_url,components,status,created_by
  ) VALUES (
    'aaaaaaa3-eeee-4aaa-8aaa-aaaaaaaaaaa3','US','US|CA|LOSANGELES|LOSANGELES|90012','USD',
    'US_STANDARD','2026.11','standard','2026-01-01',NULL,'2026-11-20','pending-review',
    'https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm',
    '[{"id":"US-STATE","name":"State sales tax","rateBps":725},{"id":"US-LOCAL","name":"Local sales tax","rateBps":125}]'::jsonb,
    'draft','77777777-7777-4777-8777-777777777777'
  );
  v_us_issue := public.global_publish_tax_rule_version('aaaaaaa3-eeee-4aaa-8aaa-aaaaaaaaaaa3','candidate-review');
  IF v_us_issue->>'ok'<>'true' THEN
    RAISE EXCEPTION 'Could not publish the test US verified rate rule: %',v_us_issue;
  END IF;

  v_us_issue := public.global_issue_invoice(
    '77777777-7777-4777-8777-777777777777',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    (v_us_draft->'invoice'->>'id')::uuid,
    '{"registration_confirmed":true,"place_of_supply_confirmed":true,"tax_category_confirmed":true,"tax_category":"US_STANDARD","mode":"automatic","tax_treatment":"standard","price_mode":"exclusive","place_of_supply":"United States","collection_obligation_attested":true,"jurisdiction_id":"US|CA|LOSANGELES|LOSANGELES|90012","destination_jurisdiction":{"state":"CA","county":"Los Angeles","city":"Los Angeles","postal_code":"90012"}}'::jsonb,
    'a4444444-4444-4444-8444-444444444444'
  );
  IF v_us_issue->>'ok'<>'true'
    OR (v_us_issue->'invoice'->>'tax_minor')::bigint<>850
    OR (v_us_issue->'invoice'->>'total_minor')::bigint<>10850
    OR v_us_issue->'invoice'->'invoice_snapshot'->>'jurisdiction_id'<>'US|CA|LOSANGELES|LOSANGELES|90012' THEN
    RAISE EXCEPTION 'US verified state/county/city tax issuance failed: %',v_us_issue;
  END IF;
  SELECT * INTO v_line FROM global.invoice_items
  WHERE invoice_id=(v_us_draft->'invoice'->>'id')::uuid LIMIT 1;
  IF v_line.tax_rate_bps<>850 OR v_line.tax_minor<>850 OR v_line.line_total_minor<>10850 THEN
    RAISE EXCEPTION 'US server-recalculated line tax is inconsistent: %',row_to_json(v_line);
  END IF;

  -- Special treatments must use an exact published rule and are recalculated
  -- on the server; a browser-selected treatment alone is never sufficient.
  v_reduced_draft := public.global_create_invoice_draft(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'GBP','2026-11-20',NULL,'UK reduced-rate tax test',
    jsonb_build_array(jsonb_build_object('description','Domestic fuel supply','quantity',1,'unit_price_minor',10000)),
    'a0000000-0000-4000-8000-000000000004'
  );
  v_reduced_invoice_id := (v_reduced_draft->'invoice'->>'id')::uuid;
  v_reduced_issue := public.global_issue_invoice(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_reduced_invoice_id,
    '{"registration_confirmed":true,"place_of_supply_confirmed":true,"tax_category_confirmed":true,"tax_category":"GB_REDUCED_FUEL_POWER","tax_treatment":"reduced","mode":"automatic","price_mode":"exclusive","place_of_supply":"United Kingdom"}'::jsonb,
    'a6666666-6666-4666-8666-666666666666'
  );
  IF v_reduced_issue->>'reason'<>'verified_special_treatment_rule_unavailable' THEN
    RAISE EXCEPTION 'Unpublished UK reduced-rate category did not fail closed: %',v_reduced_issue;
  END IF;

  v_reduced_issue := public.global_issue_invoice(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_reduced_invoice_id,
    '{"registration_confirmed":true,"place_of_supply_confirmed":true,"tax_category_confirmed":true,"tax_category":"GB_REDUCED_FUEL_POWER","tax_treatment":"reduced","mode":"automatic","price_mode":"exclusive","place_of_supply":"United Kingdom"}'::jsonb,
    'a6666666-6666-4666-8666-666666666666'
  );
  IF v_reduced_issue->>'ok'<>'true'
    OR (v_reduced_issue->'invoice'->>'tax_minor')::bigint<>500
    OR (v_reduced_issue->'invoice'->>'total_minor')::bigint<>10500
    OR v_reduced_issue->'invoice'->'invoice_snapshot'->>'tax_treatment'<>'reduced' THEN
    RAISE EXCEPTION 'Published UK reduced-rate rule was not applied server-side: %',v_reduced_issue;
  END IF;

  -- Reverse-charge VAT is calculated for the registered buyer but is not
  -- added to the seller's invoice payable total.
  UPDATE global.clients SET tax_registration_number='GB987654321'
  WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    AND workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_reverse_draft := public.global_create_invoice_draft(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'GBP','2026-11-20',NULL,'UK reverse-charge test',
    jsonb_build_array(jsonb_build_object('description','Construction service','quantity',1,'unit_price_minor',10000)),
    'a0000000-0000-4000-8000-000000000005'
  );
  v_reverse_invoice_id := (v_reverse_draft->'invoice'->>'id')::uuid;
  v_reverse_issue := public.global_issue_invoice(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_reverse_invoice_id,
    '{"registration_confirmed":true,"place_of_supply_confirmed":true,"tax_category_confirmed":true,"tax_category":"GB_DOMESTIC_CONSTRUCTION_REVERSE_CHARGE","tax_treatment":"reverse-charge","mode":"automatic","price_mode":"exclusive","place_of_supply":"United Kingdom"}'::jsonb,
    'a7777777-7777-4777-8777-777777777777'
  );
  IF v_reverse_issue->>'reason'<>'reverse_charge_buyer_evidence_required' THEN
    RAISE EXCEPTION 'Reverse charge did not require buyer evidence: %',v_reverse_issue;
  END IF;
  v_reverse_issue := public.global_issue_invoice(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    v_reverse_invoice_id,
    '{"registration_confirmed":true,"place_of_supply_confirmed":true,"tax_category_confirmed":true,"tax_category":"GB_DOMESTIC_CONSTRUCTION_REVERSE_CHARGE","tax_treatment":"reverse-charge","mode":"automatic","price_mode":"exclusive","place_of_supply":"United Kingdom","buyer_registration_confirmed":true,"reverse_charge_conditions_confirmed":true,"buyer_country_code":"GB","buyer_registration_number":"GB987654321"}'::jsonb,
    'a7777777-7777-4777-8777-777777777777'
  );
  IF v_reverse_issue->>'ok'<>'true'
    OR (v_reverse_issue->'invoice'->>'tax_minor')::bigint<>0
    OR (v_reverse_issue->'invoice'->>'reverse_charge_tax_minor')::bigint<>2000
    OR (v_reverse_issue->'invoice'->>'total_minor')::bigint<>10000
    OR v_reverse_issue->'invoice'->'invoice_snapshot'->>'reverse_charge_buyer_accounting'<>'true'
    OR (v_reverse_issue->'invoice'->'invoice_snapshot'->'calculation'->>'reverse_charge_tax_minor')::bigint<>2000 THEN
    RAISE EXCEPTION 'Reverse-charge tax was added to seller payable total or not recorded for buyer: %',v_reverse_issue;
  END IF;
  SELECT * INTO v_line FROM global.invoice_items WHERE invoice_id=v_reverse_invoice_id LIMIT 1;
  IF v_line.tax_minor<>0 OR v_line.reverse_charge_tax_minor<>2000 OR v_line.line_total_minor<>10000 THEN
    RAISE EXCEPTION 'Reverse-charge invoice line values are inconsistent: %',row_to_json(v_line);
  END IF;
END
$global_invoice_issuance$;
RESET ROLE;

SET ROLE authenticated;
DO $invoice_rpc_privileges$
BEGIN
  IF has_function_privilege('authenticated','public.global_issue_invoice(uuid,uuid,uuid,jsonb,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.global_record_invoice_refund(uuid,uuid,uuid,bigint,text,date,text,text,text,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.global_list_invoice_reconciliation(uuid,uuid,integer)','EXECUTE')
    OR has_table_privilege('authenticated','global.invoice_number_sequences','SELECT')
    OR has_table_privilege('authenticated','global.invoice_number_sequences','INSERT') THEN
    RAISE EXCEPTION 'Authenticated role can access privileged Global invoice issuance functions or sequence table';
  END IF;
END
$invoice_rpc_privileges$;
RESET ROLE;

SELECT 'PASS GB invoice numbering, VAT snapshot, immutability, payment/refund ledger, reconciliation and non-GB fail-closed issuance' AS result;
