\set ON_ERROR_STOP on
-- Runs in the disposable candidate database after global-multicurrency-expense.integration.sql.
SET ROLE service_role;
DO $global_tax_audit$
DECLARE
  rule_id uuid := 'aaaaaaa1-eeee-4aaa-8aaa-aaaaaaaaaaa1';
  overlapping_rule_id uuid := 'aaaaaaa2-eeee-4aaa-8aaa-aaaaaaaaaaa2';
  published jsonb;
  overlap_result jsonb;
  audit_id uuid;
  audit_count bigint;
  immutable_rejected boolean := false;
  rule_immutable_rejected boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);

  INSERT INTO global.tax_rule_versions(
    id,country_code,jurisdiction_id,currency_code,tax_code,version,treatment,
    effective_from,effective_to,reviewed_on,reviewed_by,source_url,components,status,created_by
  ) VALUES (
    rule_id,'GB',NULL,'GBP','VAT_STANDARD','2026.11','standard',
    '2011-01-04',NULL,current_date,'pending-review',
    'https://www.gov.uk/vat-rates',
    '[{"id":"VAT","rateBps":2000}]'::jsonb,'draft',
    '66666666-6666-4666-8666-666666666666'
  );

  published := public.global_publish_tax_rule_version(rule_id,'candidate-review');
  IF published->>'ok'<>'true'
    OR (SELECT status FROM global.tax_rule_versions WHERE id=rule_id)<>'verified'
    OR (SELECT reviewed_by FROM global.tax_rule_versions WHERE id=rule_id)<>'candidate-review' THEN
    RAISE EXCEPTION 'Controlled tax rule publication failed: %',published;
  END IF;

  audit_id := public.global_append_tax_calculation_audit(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '55555555-eeee-4555-8555-555555555555',
    1,
    jsonb_build_object(
      'countryCode','GB','currencyCode','GBP','ruleId',rule_id,
      'ruleVersion','2026.11','jurisdictionId',NULL,'invoiceDate','2026-11-15',
      'taxableMinor',10000,'taxMinor',2000,'totalMinor',12000,
      'ruleSnapshot',jsonb_build_object('source','https://www.gov.uk/vat-rates','effectiveFrom','2011-01-04')
    )
  );
  SELECT count(*) INTO audit_count FROM global.tax_calculation_audit
    WHERE id=audit_id AND workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      AND invoice_id='55555555-eeee-4555-8555-555555555555'
      AND taxable_minor=10000 AND tax_minor=2000 AND total_minor=12000;
  IF audit_count<>1 THEN RAISE EXCEPTION 'Immutable tax calculation audit row was not persisted'; END IF;

  BEGIN
    UPDATE global.tax_calculation_audit SET tax_minor=0 WHERE id=audit_id;
  EXCEPTION WHEN OTHERS THEN
    immutable_rejected := true;
  END;
  IF NOT immutable_rejected THEN RAISE EXCEPTION 'Tax calculation audit row accepted an update'; END IF;

  INSERT INTO global.tax_rule_versions(
    id,country_code,jurisdiction_id,currency_code,tax_code,version,treatment,
    effective_from,effective_to,reviewed_on,reviewed_by,source_url,components,status,created_by
  ) VALUES (
    overlapping_rule_id,'GB',NULL,'GBP','VAT_STANDARD','2026.12','standard',
    '2026-01-01',NULL,current_date,'pending-review',
    'https://www.gov.uk/vat-rates',
    '[{"id":"VAT","rateBps":2000}]'::jsonb,'draft',
    '66666666-6666-4666-8666-666666666666'
  );
  overlap_result := public.global_publish_tax_rule_version(overlapping_rule_id,'candidate-review');
  IF overlap_result->>'code'<>'OVERLAPPING_VERIFIED_RULE' THEN
    RAISE EXCEPTION 'Overlapping tax rule version was not rejected: %',overlap_result;
  END IF;

  BEGIN
    UPDATE global.tax_rule_versions SET status='draft' WHERE id=rule_id;
  EXCEPTION WHEN OTHERS THEN
    rule_immutable_rejected := true;
  END;
  IF NOT rule_immutable_rejected THEN RAISE EXCEPTION 'Published tax rule accepted a reverse transition'; END IF;
END
$global_tax_audit$;
RESET ROLE;

SET ROLE authenticated;
DO $tax_audit_privileges$
BEGIN
  IF has_function_privilege('authenticated','public.global_publish_tax_rule_version(uuid,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.global_append_tax_calculation_audit(uuid,uuid,uuid,integer,jsonb)','EXECUTE')
    OR has_table_privilege('authenticated','global.tax_calculation_audit','INSERT') THEN
    RAISE EXCEPTION 'Authenticated role can publish tax rules or write tax audit records directly';
  END IF;
END
$tax_audit_privileges$;
RESET ROLE;

SELECT 'PASS Global tax-rule publication gate, jurisdiction-safe registry, overlap rejection and immutable tax audit records' AS result;
