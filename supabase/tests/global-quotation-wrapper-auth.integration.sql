\set ON_ERROR_STOP on
BEGIN;

-- Browser roles must not be able to call the tax-aware RPC directly with a
-- caller-supplied amount or snapshot.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);

DO $quotation_wrapper_browser_acl$
BEGIN
  IF has_function_privilege('authenticated',
    'public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated role can execute the tax-aware quotation RPC directly';
  END IF;
END
$quotation_wrapper_browser_acl$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);

DO $quotation_wrapper_service_role$
DECLARE
  v_spoofed jsonb;
  v_valid jsonb;
  v_tax_created jsonb;
  v_tax_sent jsonb;
  v_tax_accepted jsonb;
  v_tax_converted jsonb;
  v_tax_quote_id uuid;
  v_tax_snapshot jsonb := '{"country_code":"GB","tax_type":"VAT","components":[{"code":"VAT_STANDARD","rate_bps":2000,"amount_minor":1900}]}'::jsonb;
BEGIN
  -- The service-only RPC still delegates membership enforcement to the
  -- legacy overload, which rejects a user id that is not an active member.
  v_spoofed := public.global_manage_quotation(
    '77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'list',NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,NULL,NULL
  );
  IF v_spoofed->>'ok' <> 'false' OR v_spoofed->>'reason' <> 'access_denied' THEN
    RAISE EXCEPTION 'Quotation wrapper accepted a non-member user id: %',v_spoofed;
  END IF;

  v_valid := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'list',NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,NULL,NULL
  );
  IF v_valid->>'ok' <> 'true' THEN
    RAISE EXCEPTION 'Quotation wrapper rejected the active workspace member: %',v_valid;
  END IF;

  v_tax_created := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'create',NULL,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','GBP',
    current_date,current_date+14,'Tax snapshot integration test',
    jsonb_build_array(jsonb_build_object('description','Taxable service','quantity',2,'unit_price_minor',5000,'discount_minor',500)),
    NULL,'b3333333-3333-4333-8333-333333333333',1900,v_tax_snapshot
  );
  IF v_tax_created->>'ok' <> 'true'
    OR (v_tax_created->'quotation'->>'tax_minor')::bigint <> 1900
    OR (v_tax_created->'quotation'->>'total_including_tax_minor')::bigint <> 11400
    OR v_tax_created->'quotation'->'tax_snapshot' <> v_tax_snapshot THEN
    RAISE EXCEPTION 'Tax-aware quotation creation did not persist the expected snapshot: %',v_tax_created;
  END IF;
  v_tax_quote_id := (v_tax_created->'quotation'->>'id')::uuid;

  v_tax_sent := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'status',v_tax_quote_id,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,'sent',NULL,NULL,NULL
  );
  IF v_tax_sent->>'ok' <> 'true' THEN RAISE EXCEPTION 'Tax quotation could not move to sent: %',v_tax_sent; END IF;

  v_tax_accepted := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'status',v_tax_quote_id,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,'accepted',NULL,NULL,NULL
  );
  IF v_tax_accepted->>'ok' <> 'true' THEN RAISE EXCEPTION 'Tax quotation could not move to accepted: %',v_tax_accepted; END IF;

  v_tax_converted := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'convert',v_tax_quote_id,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,NULL,NULL
  );
  IF v_tax_converted->>'ok' <> 'true'
    OR (v_tax_converted->'invoice'->>'total_minor')::bigint <> 11400
    OR v_tax_converted->'invoice'->'invoice_snapshot'->'global_tax_snapshot' <> v_tax_snapshot THEN
    RAISE EXCEPTION 'Quotation-to-invoice conversion did not carry the tax snapshot: %',v_tax_converted;
  END IF;
END
$quotation_wrapper_service_role$;

RESET ROLE;
ROLLBACK;
