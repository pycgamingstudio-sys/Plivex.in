\set ON_ERROR_STOP on
-- Runs against the disposable Global migration replay fixture only.
SET ROLE service_role;
DO $global_quotations$
DECLARE
  v_created jsonb;
  v_retry jsonb;
  v_conflict jsonb;
  v_sent jsonb;
  v_accepted jsonb;
  v_converted jsonb;
  v_convert_retry jsonb;
  v_unaccepted jsonb;
  v_special_quote jsonb;
  v_quote_id uuid;
  v_special_quote_id uuid;
  v_invoice_id uuid;
  v_invoice global.invoices%rowtype;
  v_key uuid := 'b1111111-1111-4111-8111-111111111111';
  v_unaccepted_key uuid := 'b2222222-2222-4222-8222-222222222222';
BEGIN
  v_created := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'create',NULL,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','GBP',
    current_date,current_date+14,'Quotation integration test',
    jsonb_build_array(jsonb_build_object(
      'description','Consulting service','quantity',2,'unit_price_minor',5000,'discount_minor',500
    )),NULL,v_key
  );
  IF v_created->>'ok'<>'true' OR v_created->'quotation'->>'status'<>'draft'
    OR (v_created->'quotation'->>'subtotal_minor')::bigint<>10000
    OR (v_created->'quotation'->>'discount_minor')::bigint<>500
    OR (v_created->'quotation'->>'total_minor')::bigint<>9500 THEN
    RAISE EXCEPTION 'Global quotation creation or totals failed: %',v_created;
  END IF;
  v_quote_id := (v_created->'quotation'->>'id')::uuid;

  -- Special treatment quotations must match a published server rule, not just
  -- a browser-supplied zero/reduced rate.
  v_special_quote := public.global_manage_quotation_with_tax(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'create',NULL,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','GBP',
    current_date,current_date+14,'UK reduced-rate quotation test',
    jsonb_build_array(jsonb_build_object('description','Qualifying domestic fuel and power','quantity',1,'unit_price_minor',10000,'discount_minor',0)),
    NULL,'b3333333-3333-4333-8333-333333333333',
    jsonb_build_object(
      'taxContext',jsonb_build_object(
        'countryCode','GB','mode','automatic','priceMode','exclusive',
        'taxTreatment','reduced','taxCategory','GB_REDUCED_DOMESTIC_FUEL_POWER',
        'taxDetailsConfirmed',true,'placeOfSupply','United Kingdom'
      ),
      'taxResult',jsonb_build_object(
        'ok',true,'status','calculated','mode','automatic','priceMode','exclusive',
        'invoiceDate',current_date::text,'currencyCode','GBP','countryCode','GB',
        'treatment','reduced','taxCategory','GB_REDUCED_DOMESTIC_FUEL_POWER',
        'taxableMinor',10000,'taxMinor',500,'totalMinor',10500,
        'ruleSnapshot',jsonb_build_object(
          'id','GB-VAT-REDUCED-DOMESTIC-FUEL-POWER-2026-11','version','2026.11',
          'treatment','reduced','taxCategoryId','GB_REDUCED_DOMESTIC_FUEL_POWER',
          'source','https://www.gov.uk/vat-rates'
        ),
        'components',jsonb_build_array(jsonb_build_object(
          'id','GB-VAT-REDUCED-DOMESTIC-FUEL-POWER','name','VAT',
          'rateBps',500,'amountMinor',500,'source','https://www.gov.uk/vat-rates'
        ))
      )
    )
  );
  IF v_special_quote->>'ok'<>'true'
    OR (v_special_quote->'quotation'->>'tax_minor')::bigint<>500
    OR (v_special_quote->'quotation'->>'total_minor')::bigint<>10500
    OR v_special_quote->'quotation'->>'tax_status'<>'calculated' THEN
    RAISE EXCEPTION 'Server did not validate and persist UK reduced-rate quotation tax: %',v_special_quote;
  END IF;
  v_special_quote_id := (v_special_quote->'quotation'->>'id')::uuid;

  v_retry := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'create',NULL,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','GBP',
    current_date,current_date+14,'Quotation integration test',
    jsonb_build_array(jsonb_build_object(
      'description','Consulting service','quantity',2,'unit_price_minor',5000,'discount_minor',500
    )),NULL,v_key
  );
  IF v_retry->>'ok'<>'true' OR v_retry->>'duplicate'<>'true'
    OR v_retry->'quotation'->>'id'<>v_quote_id::text THEN
    RAISE EXCEPTION 'Quotation create retry was not idempotent: %',v_retry;
  END IF;

  v_conflict := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'create',NULL,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','GBP',
    current_date,current_date+14,'Changed payload',
    jsonb_build_array(jsonb_build_object(
      'description','Different service','quantity',2,'unit_price_minor',5000,'discount_minor',500
    )),NULL,v_key
  );
  IF v_conflict->>'ok'<>'false' OR v_conflict->>'reason'<>'idempotency_conflict' THEN
    RAISE EXCEPTION 'Quotation idempotency accepted a changed payload: %',v_conflict;
  END IF;

  v_unaccepted := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'create',NULL,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','GBP',
    current_date,NULL,NULL,
    jsonb_build_array(jsonb_build_object('description','Not accepted','quantity',1,'unit_price_minor',1000)),NULL,v_unaccepted_key
  );
  IF v_unaccepted->>'ok'<>'true' THEN RAISE EXCEPTION 'Could not create unaccepted quotation fixture: %',v_unaccepted; END IF;
  v_unaccepted := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'convert',(v_unaccepted->'quotation'->>'id')::uuid
  );
  IF v_unaccepted->>'ok'<>'false' OR v_unaccepted->>'reason'<>'quotation_not_accepted' THEN
    RAISE EXCEPTION 'Unaccepted quotation converted to an invoice: %',v_unaccepted;
  END IF;

  v_sent := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','status',v_quote_id,
    NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,'sent',NULL
  );
  IF v_sent->>'ok'<>'true' OR v_sent->'quotation'->>'status'<>'sent' THEN
    RAISE EXCEPTION 'Quotation sent transition failed: %',v_sent;
  END IF;
  v_accepted := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','status',v_quote_id,
    NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,'accepted',NULL
  );
  IF v_accepted->>'ok'<>'true' OR v_accepted->'quotation'->>'status'<>'accepted' THEN
    RAISE EXCEPTION 'Quotation accepted transition failed: %',v_accepted;
  END IF;

  v_converted := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','convert',v_quote_id
  );
  IF v_converted->>'ok'<>'true' OR v_converted->'quotation'->>'status'<>'converted'
    OR v_converted->'invoice'->>'status'<>'draft'
    OR (v_converted->'invoice'->>'total_minor')::bigint<>9500 THEN
    RAISE EXCEPTION 'Accepted quotation did not convert to a matching invoice draft: %',v_converted;
  END IF;
  v_invoice_id := (v_converted->'invoice'->>'id')::uuid;
  SELECT * INTO v_invoice FROM global.invoices WHERE id=v_invoice_id AND workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  IF v_invoice.notes NOT LIKE '%Converted from quotation %' OR v_invoice.amount_paid_minor<>0 THEN
    RAISE EXCEPTION 'Converted invoice draft has unexpected notes or payment balance: %',row_to_json(v_invoice);
  END IF;
  IF EXISTS (SELECT 1 FROM global.invoice_payments WHERE invoice_id=v_invoice_id) THEN
    RAISE EXCEPTION 'Quotation conversion unexpectedly created payment ledger entries';
  END IF;

  v_convert_retry := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','convert',v_quote_id
  );
  IF v_convert_retry->>'ok'<>'true' OR v_convert_retry->>'duplicate'<>'true'
    OR v_convert_retry->'invoice'->>'id'<>v_invoice_id::text THEN
    RAISE EXCEPTION 'Quotation conversion retry was not idempotent: %',v_convert_retry;
  END IF;

  IF has_function_privilege('anon','public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Global quotation RPC privileges are not service-role-only';
  END IF;
  RAISE NOTICE 'PASS Global quotations: isolated model, totals, idempotency, status lifecycle, accepted-only conversion, invoice draft and payment isolation';
END;
$global_quotations$;
RESET ROLE;
