\set ON_ERROR_STOP on
-- Disposable fixture for the global invoice tax RPC. No hosted database is touched.
CREATE SCHEMA IF NOT EXISTS auth;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END
$roles$;
CREATE TYPE public.app_role AS ENUM ('admin','manager','employee','accountant');
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL,
  role public.app_role NOT NULL
);
CREATE TABLE public.business_profile (
  workspace_id text PRIMARY KEY,
  country_code text,
  tax_registration_number text,
  tax_registration_type text,
  tax_registration_status text DEFAULT 'unregistered',
  tax_registration_effective_from date,
  tax_jurisdiction_code text
);
CREATE TABLE public.invoice_counters (workspace_id text PRIMARY KEY, last_number integer NOT NULL);
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  created_by uuid NOT NULL,
  number text NOT NULL,
  client_name text,
  client_email text,
  business_name text,
  issue_date date DEFAULT CURRENT_DATE,
  due_date date,
  currency text DEFAULT 'INR',
  tax_mode text DEFAULT 'split',
  tax_rate numeric DEFAULT 0,
  discount_type text DEFAULT 'percent',
  discount numeric DEFAULT 0,
  notes text,
  terms text,
  status text DEFAULT 'Pending',
  is_draft boolean DEFAULT false,
  subtotal numeric DEFAULT 0,
  tax_value numeric DEFAULT 0,
  cgst numeric DEFAULT 0,
  sgst numeric DEFAULT 0,
  igst numeric DEFAULT 0,
  total numeric DEFAULT 0,
  stock_applied boolean DEFAULT false,
  invoice_snapshot jsonb,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  description text NOT NULL,
  quantity numeric NOT NULL,
  rate numeric NOT NULL,
  gst_rate numeric
);
CREATE TABLE public.stock (workspace_id text NOT NULL, name text NOT NULL, quantity numeric NOT NULL);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
CREATE OR REPLACE FUNCTION public.ist_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT CURRENT_DATE $$;

\ir ../migrations/20261114000003_global_invoice_tax_calculation.sql
CREATE TEMP TABLE save_invoice_rpc_baseline AS
SELECT pg_get_functiondef('public.save_invoice(jsonb,jsonb,uuid)'::regprocedure) AS definition, p.proowner, p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p WHERE p.oid='public.save_invoice(jsonb,jsonb,uuid)'::regprocedure;
BEGIN;
\ir ../migrations/20261114000004_global_tax_snapshot_hardening.sql
ROLLBACK;
DO $rollback$
DECLARE b record; p record;
BEGIN
  SELECT * INTO b FROM save_invoice_rpc_baseline;
  SELECT pg_get_functiondef('public.save_invoice(jsonb,jsonb,uuid)'::regprocedure) AS definition, proowner, prosecdef, proconfig, proacl INTO p
  FROM pg_proc WHERE oid='public.save_invoice(jsonb,jsonb,uuid)'::regprocedure;
  IF p.definition IS DISTINCT FROM b.definition OR p.proowner IS DISTINCT FROM b.proowner
    OR p.prosecdef IS DISTINCT FROM b.prosecdef OR p.proconfig IS DISTINCT FROM b.proconfig OR p.proacl IS DISTINCT FROM b.proacl THEN
    RAISE EXCEPTION 'Migration rollback did not restore save_invoice definition/ACL/owner/security/search_path';
  END IF;
END
$rollback$;
\ir ../migrations/20261114000004_global_tax_snapshot_hardening.sql
CREATE TEMP TABLE save_invoice_rpc_applied AS
SELECT pg_get_functiondef('public.save_invoice(jsonb,jsonb,uuid)'::regprocedure) AS definition, p.proowner, p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p WHERE p.oid='public.save_invoice(jsonb,jsonb,uuid)'::regprocedure;
\ir ../migrations/20261114000004_global_tax_snapshot_hardening.sql
DO $reapply$
DECLARE b record; p record;
BEGIN
  SELECT * INTO b FROM save_invoice_rpc_applied;
  SELECT pg_get_functiondef('public.save_invoice(jsonb,jsonb,uuid)'::regprocedure) AS definition, proowner, prosecdef, proconfig, proacl INTO p
  FROM pg_proc WHERE oid='public.save_invoice(jsonb,jsonb,uuid)'::regprocedure;
  IF p.definition IS DISTINCT FROM b.definition OR p.proowner IS DISTINCT FROM b.proowner
    OR p.prosecdef IS DISTINCT FROM b.prosecdef OR p.proconfig IS DISTINCT FROM b.proconfig OR p.proacl IS DISTINCT FROM b.proacl THEN
    RAISE EXCEPTION 'Migration reapplication changed save_invoice definition/ACL/owner/security/search_path';
  END IF;
  IF p.prosecdef IS NOT TRUE OR NOT ('search_path=public, pg_temp' = ANY(p.proconfig))
    OR NOT has_function_privilege('authenticated','public.save_invoice(jsonb,jsonb,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.save_invoice(jsonb,jsonb,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'save_invoice SECURITY DEFINER/search_path/ACL boundary is invalid';
  END IF;
END
$reapply$;

INSERT INTO public.profiles(id,workspace_id,role)
VALUES ('11111111-1111-4111-8111-111111111111','workspace-global','admin');
INSERT INTO public.business_profile(workspace_id,country_code,tax_registration_number,tax_registration_type,tax_registration_status,tax_registration_effective_from,tax_jurisdiction_code)
VALUES ('workspace-global','GB','GB123456789','VAT','registered','2026-01-01',NULL);
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
GRANT ALL ON public.profiles, public.business_profile, public.invoice_counters, public.invoices, public.invoice_items, public.stock TO authenticated;
SET ROLE authenticated;
DO $security$
DECLARE v public.invoices;
BEGIN
  v := public.save_invoice(
    jsonb_build_object(
      'client_name','Snapshot customer','business_name','Seller Ltd','issue_date','2026-11-14','currency','GBP',
      'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
      'invoice_snapshot',jsonb_build_object(
        'business',jsonb_build_object('name','Seller Ltd','address','12 Display Road','email','seller@example.test','phone','+44-20-0000-0000','taxRegistrationNumber','FORGED-BUSINESS','taxRegistrationType','Fake','taxRegistrationStatus','unregistered','taxRegistrationEffectiveFrom','2099-01-01','registeredJurisdiction','US-ZZ'),
        'globalTaxProfileSnapshot',jsonb_build_object('countryCode','ZZ','registrationNumber','FORGED-SNAPSHOT','registrationType','Fake','registrationStatus','cancelled','registrationEffectiveFrom','2099-01-01','registeredJurisdiction','US-ZZ'),
        'globalTax',jsonb_build_object('countryCode','GB','mode','automatic','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','United Kingdom','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true),
        'globalTaxCalculation',jsonb_build_object('ok',true,'status','calculated','countryCode','GB','currencyCode','GBP','taxableMinor',10000,'taxMinor',2000,'totalMinor',12000,
          'components',jsonb_build_array(jsonb_build_object('id','GB-VAT-STANDARD-2026-11','name','VAT','rateBps',2000,'amountMinor',2000)),
          'ruleSnapshot',jsonb_build_object('id','GB-VAT-STANDARD-2026-11','version','2026.11','source','https://www.gov.uk/vat-rates','effectiveFrom','2011-01-04','reviewedOn','2026-11-14'))
      )
    ),
    '[{"description":"Snapshot test","quantity":1,"rate":100}]'::jsonb, NULL
  );
  IF v.invoice_snapshot->'globalTaxProfileSnapshot'->>'registrationNumber' <> 'GB123456789'
    OR v.invoice_snapshot->'globalTaxProfileSnapshot'->>'registrationType' <> 'VAT'
    OR v.invoice_snapshot->'globalTaxProfileSnapshot'->>'registrationStatus' <> 'registered'
    OR v.invoice_snapshot->'globalTaxProfileSnapshot'->>'registrationEffectiveFrom' <> '2026-01-01'
    OR v.invoice_snapshot->'globalTaxProfileSnapshot'->>'registeredJurisdiction' IS NOT NULL
    OR v.invoice_snapshot->'business'->>'taxRegistrationNumber' <> 'GB123456789'
    OR v.invoice_snapshot->'business'->>'taxRegistrationType' <> 'VAT'
    OR v.invoice_snapshot->'business'->>'name' <> 'Seller Ltd'
    OR v.invoice_snapshot->'business'->>'address' <> '12 Display Road'
    OR v.invoice_snapshot->'business'->>'email' <> 'seller@example.test' THEN
    RAISE EXCEPTION 'RPC did not replace forged registration metadata or preserve seller display fields';
  END IF;
  UPDATE public.business_profile SET tax_registration_number='GB987654321',tax_registration_type='VAT-UPDATED',
    tax_registration_status='registered',tax_registration_effective_from='2026-02-01',tax_jurisdiction_code='GB-ENG'
  WHERE workspace_id='workspace-global';
  v := public.save_invoice(
    jsonb_build_object('client_name','Snapshot customer','business_name','Seller Ltd','issue_date','2026-11-14','currency','GBP',
      'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
      'invoice_snapshot',v.invoice_snapshot || jsonb_build_object(
        'globalTaxProfileSnapshot',jsonb_build_object('registrationNumber','FORGED-AGAIN'),
        'business',v.invoice_snapshot->'business' || jsonb_build_object('taxRegistrationNumber','FORGED-AGAIN'))),
    '[{"description":"Snapshot test updated","quantity":1,"rate":100}]'::jsonb, v.id
  );
  IF v.invoice_snapshot->'globalTaxProfileSnapshot'->>'registrationNumber' <> 'GB987654321'
    OR v.invoice_snapshot->'globalTaxProfileSnapshot'->>'registrationType' <> 'VAT-UPDATED'
    OR v.invoice_snapshot->'globalTaxProfileSnapshot'->>'registrationEffectiveFrom' <> '2026-02-01'
    OR v.invoice_snapshot->'globalTaxProfileSnapshot'->>'registeredJurisdiction' <> 'GB-ENG' THEN
    RAISE EXCEPTION 'Updated business_profile registration values were not persisted';
  END IF;
END
$security$;
RESET ROLE;
UPDATE public.business_profile SET tax_registration_number='GB123456789',tax_registration_type='VAT',
  tax_registration_status='registered',tax_registration_effective_from='2026-01-01',tax_jurisdiction_code=NULL
WHERE workspace_id='workspace-global';

DO $test$
DECLARE v public.invoices;
BEGIN
  v := public.save_invoice(
    jsonb_build_object(
      'client_name','UK customer','business_name','UK seller','issue_date','2026-11-14','currency','GBP',
      'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
      'invoice_snapshot',jsonb_build_object(
        'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
        'globalTax',jsonb_build_object('countryCode','GB','mode','automatic','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','United Kingdom','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true),
        'globalTaxCalculation',jsonb_build_object('ok',true,'status','calculated','countryCode','GB','currencyCode','GBP','taxableMinor',10000,'taxMinor',2000,'totalMinor',12000,
          'components',jsonb_build_array(jsonb_build_object('id','GB-VAT-STANDARD-2026-11','name','VAT','rateBps',2000,'amountMinor',2000)),
          'ruleSnapshot',jsonb_build_object('id','GB-VAT-STANDARD-2026-11','version','2026.11','source','https://www.gov.uk/vat-rates','effectiveFrom','2011-01-04','reviewedOn','2026-11-14'))
      )
    ),
    '[{"description":"Consulting","quantity":1,"rate":100}]'::jsonb,
    NULL
  );
  IF v.tax_value <> 20 OR v.total <> 120 OR v.cgst <> 0 OR v.sgst <> 0 OR v.igst <> 0 THEN
    RAISE EXCEPTION 'UK exclusive global tax totals incorrect: tax %, total %',v.tax_value,v.total;
  END IF;

  v := public.save_invoice(
    jsonb_build_object(
      'client_name','UK customer','business_name','UK seller','issue_date','2026-11-14','currency','GBP',
      'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
      'invoice_snapshot',jsonb_build_object(
        'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
        'globalTax',jsonb_build_object('countryCode','GB','mode','automatic','priceMode','inclusive','registrationConfirmed',true,'placeOfSupply','United Kingdom','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true),
        'globalTaxCalculation',jsonb_build_object('ok',true,'status','calculated','countryCode','GB','currencyCode','GBP','taxableMinor',10000,'taxMinor',2000,'totalMinor',12000,
          'components',jsonb_build_array(jsonb_build_object('id','GB-VAT-STANDARD-2026-11','name','VAT','rateBps',2000,'amountMinor',2000)),
          'ruleSnapshot',jsonb_build_object('id','GB-VAT-STANDARD-2026-11','version','2026.11','source','https://www.gov.uk/vat-rates','effectiveFrom','2011-01-04','reviewedOn','2026-11-14'))
      )
    ),
    '[{"description":"VAT inclusive service","quantity":1,"rate":120}]'::jsonb,
    NULL
  );
  IF v.tax_value <> 20 OR v.total <> 120 OR v.subtotal <> 120 THEN
    RAISE EXCEPTION 'UK inclusive global tax totals incorrect: tax %, total %, subtotal %',v.tax_value,v.total,v.subtotal;
  END IF;
END
$test$;

-- Legal rule boundary is independent from the rule review date.
UPDATE public.business_profile SET tax_registration_effective_from='2000-01-01' WHERE workspace_id='workspace-global';
DO $legal_boundary$
DECLARE v public.invoices; rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.save_invoice(
      jsonb_build_object('client_name','UK historical customer','business_name','UK seller','issue_date','2011-01-03','currency','GBP',
        'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
        'invoice_snapshot',jsonb_build_object(
          'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
          'globalTax',jsonb_build_object('countryCode','GB','mode','automatic','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','United Kingdom','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true),
          'globalTaxCalculation',jsonb_build_object('ok',true,'status','calculated','countryCode','GB','currencyCode','GBP','taxableMinor',10000,'taxMinor',2000,'totalMinor',12000,
            'components',jsonb_build_array(jsonb_build_object('id','GB-VAT-STANDARD-2026-11','name','VAT','rateBps',2000,'amountMinor',2000)),
            'ruleSnapshot',jsonb_build_object('id','GB-VAT-STANDARD-2026-11','version','2026.11','source','https://www.gov.uk/vat-rates','effectiveFrom','2011-01-04','reviewedOn','2026-11-14'))
        )),
      '[{"description":"Historical service","quantity":1,"rate":100}]'::jsonb,NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'GB standard rate was accepted before its legal effective date'; END IF;

  v := public.save_invoice(
    jsonb_build_object('client_name','UK boundary customer','business_name','UK seller','issue_date','2011-01-04','currency','GBP',
      'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
      'invoice_snapshot',jsonb_build_object(
        'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
        'globalTax',jsonb_build_object('countryCode','GB','mode','automatic','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','United Kingdom','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true),
        'globalTaxCalculation',jsonb_build_object('ok',true,'status','calculated','countryCode','GB','currencyCode','GBP','taxableMinor',10000,'taxMinor',2000,'totalMinor',12000,
          'components',jsonb_build_array(jsonb_build_object('id','GB-VAT-STANDARD-2026-11','name','VAT','rateBps',2000,'amountMinor',2000)),
          'ruleSnapshot',jsonb_build_object('id','GB-VAT-STANDARD-2026-11','version','2026.11','source','https://www.gov.uk/vat-rates','effectiveFrom','2011-01-04','reviewedOn','2026-11-14'))
      )),
    '[{"description":"Boundary service","quantity":1,"rate":100}]'::jsonb,NULL);
  IF v.tax_value <> 20 OR v.total <> 120 THEN RAISE EXCEPTION 'GB rule failed on its legal effective date'; END IF;
END
$legal_boundary$;
UPDATE public.business_profile SET tax_registration_effective_from='2026-01-01' WHERE workspace_id='workspace-global';

-- Unknown, blank and special-scheme manual labels are rejected by the server RPC.
DO $manual_treatment$
DECLARE treatment text; rejected boolean;
BEGIN
  FOREACH treatment IN ARRAY ARRAY['', 'special scheme', 'custom taxable label', 'reverse charge'] LOOP
    rejected := false;
    BEGIN
      PERFORM public.save_invoice(
        jsonb_build_object('client_name','Manual customer','business_name','GB seller','issue_date','2026-11-14','currency','GBP',
          'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
          'invoice_snapshot',jsonb_build_object(
            'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
            'globalTax',jsonb_build_object('countryCode','GB','mode','manual','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','United Kingdom','placeOfSupplyConfirmed',true,'taxCategory',treatment,'taxCategoryConfirmed',true),
            'globalTaxCalculation',jsonb_build_object('ok',true,'status','manual_unverified','countryCode','GB','currencyCode','GBP','taxableMinor',10000,'taxMinor',2000,'totalMinor',12000,
              'components',jsonb_build_array(jsonb_build_object('id','manual-vat','name','VAT','rateBps',2000,'amountMinor',2000)))
          )),
        '[{"description":"Manual service","quantity":1,"rate":100}]'::jsonb,NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unsupported manual tax treatment was accepted: %',treatment; END IF;
  END LOOP;
END
$manual_treatment$;

-- Server RPC coverage for the other source-backed standard-rate countries.
DO $test$
DECLARE
  v public.invoices;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('AE','AED',500,'AE-VAT-STANDARD-2026-11','https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/','VAT'),
      ('AU','AUD',1000,'AU-GST-STANDARD-2026-11','https://www.ato.gov.au/Business/GST/','GST'),
      ('SG','SGD',900,'SG-GST-STANDARD-2026-11','https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/current-gst-rates','GST')
    ) AS rules(country_code,currency_code,rate_bps,rule_id,source_url,registration_type)
  LOOP
    UPDATE public.business_profile
    SET country_code=r.country_code,tax_registration_number='REG-'||r.country_code,
        tax_registration_type=r.registration_type,tax_registration_status='registered',
        tax_registration_effective_from='2026-01-01',tax_jurisdiction_code=NULL
    WHERE workspace_id='workspace-global';

    v := public.save_invoice(
      jsonb_build_object(
        'client_name','Global customer','business_name','Global seller','issue_date','2026-11-14','currency',r.currency_code,
        'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
        'invoice_snapshot',jsonb_build_object(
          'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
          'globalTax',jsonb_build_object('countryCode',r.country_code,'mode','automatic','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','Domestic supply','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true),
          'globalTaxCalculation',jsonb_build_object('ok',true,'status','calculated','countryCode',r.country_code,'currencyCode',r.currency_code,'taxableMinor',10000,'taxMinor',r.rate_bps,'totalMinor',10000+r.rate_bps,
            'components',jsonb_build_array(jsonb_build_object('id',r.rule_id,'name',r.registration_type,'rateBps',r.rate_bps,'amountMinor',r.rate_bps)),
            'ruleSnapshot',jsonb_build_object('id',r.rule_id,'version','2026.11','source',r.source_url,'effectiveFrom',CASE r.country_code WHEN 'AE' THEN '2018-01-01' WHEN 'AU' THEN '2000-07-01' WHEN 'SG' THEN '2024-01-01' ELSE '2011-01-04' END,'reviewedOn','2026-11-14'))
        )
      ),
      '[{"description":"Global taxable service","quantity":1,"rate":100}]'::jsonb,
      NULL
    );
    IF v.tax_value <> r.rate_bps::numeric / 100 OR v.total <> 100 + r.rate_bps::numeric / 100 THEN
      RAISE EXCEPTION 'Server tax RPC failed for country %: tax %, total %',r.country_code,v.tax_value,v.total;
    END IF;
  END LOOP;
END
$test$;

-- The RPC must reject a client-tampered tax snapshot even when the country/rule are valid.
UPDATE public.business_profile SET country_code='GB',tax_registration_number='GB123456789',tax_registration_type='VAT',tax_registration_status='registered',tax_registration_effective_from='2026-01-01',tax_jurisdiction_code=NULL WHERE workspace_id='workspace-global';
DO $test$
BEGIN
  BEGIN
    PERFORM public.save_invoice(
      jsonb_build_object(
        'client_name','UK customer','business_name','UK seller','issue_date','2026-11-14','currency','GBP',
        'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
        'invoice_snapshot',jsonb_build_object(
          'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
          'globalTax',jsonb_build_object('countryCode','GB','mode','automatic','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','United Kingdom','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true),
          'globalTaxCalculation',jsonb_build_object('ok',true,'status','calculated','countryCode','GB','currencyCode','GBP','taxableMinor',10000,'taxMinor',1999,'totalMinor',11999,
            'components',jsonb_build_array(jsonb_build_object('id','GB-VAT-STANDARD-2026-11','name','VAT','rateBps',2000,'amountMinor',2000)),
            'ruleSnapshot',jsonb_build_object('id','GB-VAT-STANDARD-2026-11','version','2026.11','source','https://www.gov.uk/vat-rates','effectiveFrom','2011-01-04','reviewedOn','2026-11-14'))
        )
      ),
      '[{"description":"Tampered service","quantity":1,"rate":100}]'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'Tampered global tax snapshot unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$test$;

UPDATE public.business_profile SET country_code='US',tax_registration_number='US-PERMIT',tax_registration_type='Sales tax',tax_jurisdiction_code='US-CA' WHERE workspace_id='workspace-global';
DO $test$
DECLARE v public.invoices;
BEGIN
  v := public.save_invoice(
    jsonb_build_object(
      'client_name','US customer','business_name','US seller','issue_date','2026-11-14','currency','USD',
      'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
      'invoice_snapshot',jsonb_build_object(
        'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
        'globalTax',jsonb_build_object('countryCode','US','mode','manual','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','Los Angeles, CA','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true,'collectionObligationAttested',true,'destinationJurisdiction',jsonb_build_object('state','NY','county','New York','city','New York')),
        'globalTaxCalculation',jsonb_build_object('ok',true,'status','manual_unverified','countryCode','US','currencyCode','USD','taxableMinor',10000,'taxMinor',625,'totalMinor',10625,
          'components',jsonb_build_array(
            jsonb_build_object('id','state','name','State sales tax','rateBps',500,'amountMinor',500,'source','user-entered'),
            jsonb_build_object('id','county','name','County sales tax','rateBps',125,'amountMinor',125,'source','user-entered')
          ))
      )
    ),
    '[{"description":"US service","quantity":1,"rate":100}]'::jsonb,
    NULL
  );
  IF v.tax_value <> 6.25 OR v.total <> 106.25 OR v.cgst <> 0 OR v.sgst <> 0 OR v.igst <> 0 THEN
    RAISE EXCEPTION 'US manual global tax totals incorrect: tax %, total %',v.tax_value,v.total;
  END IF;
END
$test$;

-- A matching string is not sufficient: region codes and country prefix must be valid.
UPDATE public.business_profile SET tax_jurisdiction_code='US-ZZ' WHERE workspace_id='workspace-global';
DO $test$
BEGIN
  BEGIN
    PERFORM public.save_invoice(
      jsonb_build_object(
        'client_name','US customer','business_name','US seller','issue_date','2026-11-14','currency','USD',
        'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
        'invoice_snapshot',jsonb_build_object(
          'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
          'globalTax',jsonb_build_object('countryCode','US','mode','manual','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','Example','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true,'collectionObligationAttested',true,'destinationJurisdiction',jsonb_build_object('state','ZZ','county','Example County','city','Example City')),
          'globalTaxCalculation',jsonb_build_object('ok',true,'status','manual_unverified','countryCode','US','currencyCode','USD','taxableMinor',10000,'taxMinor',500,'totalMinor',10500,
            'components',jsonb_build_array(jsonb_build_object('id','state','name','State sales tax','rateBps',500,'amountMinor',500,'source','user-entered')))
        )
      ),
      '[{"description":"US test service","quantity":1,"rate":100}]'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'US invalid jurisdiction unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$test$;

UPDATE public.business_profile SET tax_jurisdiction_code='CA-ON' WHERE workspace_id='workspace-global';
UPDATE public.business_profile SET country_code='CA',tax_registration_number='CA-ACCOUNT',tax_registration_type='GST/HST',tax_registration_status='registered',tax_registration_effective_from='2026-01-01',tax_jurisdiction_code='CA-ON' WHERE workspace_id='workspace-global';
DO $test$
DECLARE v public.invoices;
BEGIN
  v := public.save_invoice(
    jsonb_build_object(
      'client_name','Canadian customer','business_name','Canadian seller','issue_date','2026-11-14','currency','CAD',
      'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
      'invoice_snapshot',jsonb_build_object(
        'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
        'globalTax',jsonb_build_object('countryCode','CA','mode','manual','priceMode','inclusive','registrationConfirmed',true,'placeOfSupply','Ontario','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true,'collectionObligationAttested',true,'destinationJurisdiction',jsonb_build_object('province','BC')),
        'globalTaxCalculation',jsonb_build_object('ok',true,'status','manual_unverified','countryCode','CA','currencyCode','CAD','taxableMinor',9259,'taxMinor',741,'totalMinor',10000,
          'components',jsonb_build_array(
            jsonb_build_object('id','gst','name','GST component','rateBps',500,'amountMinor',463,'source','user-entered'),
            jsonb_build_object('id','pst','name','Provincial component','rateBps',300,'amountMinor',278,'source','user-entered')
          ))
      )
    ),
    '[{"description":"Canadian test service","quantity":1,"rate":100}]'::jsonb,
    NULL
  );
  IF v.tax_value <> 7.41 OR v.total <> 100 OR v.subtotal <> 100 THEN
    RAISE EXCEPTION 'Canada inclusive manual tax totals incorrect: tax %, total %, subtotal %',v.tax_value,v.total,v.subtotal;
  END IF;
END
$test$;

UPDATE public.business_profile SET country_code='US',tax_registration_number='US-PERMIT',tax_registration_type='Sales tax',tax_registration_status='registered',tax_registration_effective_from='2026-01-01',tax_jurisdiction_code='US-CA' WHERE workspace_id='workspace-global';
DO $test$
BEGIN
  BEGIN
    PERFORM public.save_invoice(
      jsonb_build_object(
        'client_name','US customer','business_name','US seller','issue_date','2026-11-14','currency','USD',
        'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
        'invoice_snapshot',jsonb_build_object(
          'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
          'globalTax',jsonb_build_object('countryCode','US','mode','manual','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','California','placeOfSupplyConfirmed',true,'taxCategory','exempt','taxCategoryConfirmed',true,'collectionObligationAttested',true,'destinationJurisdiction',jsonb_build_object('state','CA','county','Los Angeles','city','Los Angeles')),
          'globalTaxCalculation',jsonb_build_object('ok',true,'status','manual_unverified','countryCode','US','currencyCode','USD','taxableMinor',10000,'taxMinor',500,'totalMinor',10500,
            'components',jsonb_build_array(jsonb_build_object('id','state','name','State sales tax','rateBps',500,'amountMinor',500,'source','user-entered')))
        )
      ),
      '[{"description":"US exempt service","quantity":1,"rate":100}]'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'US manual exempt treatment unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    PERFORM public.save_invoice(
      jsonb_build_object(
        'client_name','US customer','business_name','US seller','issue_date','2026-11-14','currency','USD',
        'tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
        'invoice_snapshot',jsonb_build_object(
          'business',jsonb_build_object('name','Seller Ltd','address','1 Business Street'),
          'globalTax',jsonb_build_object('countryCode','US','mode','automatic','priceMode','exclusive','registrationConfirmed',true,'placeOfSupply','California','placeOfSupplyConfirmed',true,'taxCategory','standard-rated','taxCategoryConfirmed',true),
          'globalTaxCalculation',jsonb_build_object('ok',true,'status','calculated','countryCode','US','currencyCode','USD','taxableMinor',10000,'taxMinor',700,'totalMinor',10700,
            'components',jsonb_build_array(jsonb_build_object('id','US-FAKE','name','Fake rate','rateBps',700,'amountMinor',700)))
        )
      ),
      '[{"description":"US service","quantity":1,"rate":100}]'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'US automatic tax unexpectedly accepted without a verified jurisdiction provider';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    PERFORM public.save_invoice(
      jsonb_build_object('client_name','US customer','business_name','US seller','issue_date','2026-11-14','currency','USD','tax_mode','split','tax_rate',0,'discount_type','percent','discount',0,'status','Pending','is_draft',false,'invoice_snapshot',jsonb_build_object('globalTax',jsonb_build_object('countryCode','US'))),
      '[{"description":"US service","quantity":1,"rate":100}]'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'US final invoice unexpectedly saved without a tax calculation';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$test$;

UPDATE public.business_profile SET country_code='IN',tax_registration_number='GSTIN',tax_registration_type='GST',tax_registration_status='registered',tax_registration_effective_from='2026-01-01',tax_jurisdiction_code=NULL WHERE workspace_id='workspace-global';
DO $test$
DECLARE v public.invoices;
BEGIN
  v := public.save_invoice(
    jsonb_build_object('client_name','India customer','business_name','India seller','issue_date','2026-11-14','currency','INR','tax_mode','split','tax_rate',18,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
      'invoice_snapshot',jsonb_build_object('business',jsonb_build_object('name','India seller','address','Agra, India'),
        'items',jsonb_build_array(jsonb_build_object('description','GST service','quantity',1,'rate',100,'gstRate',18,'hsnSac','998313')))),
    '[{"description":"GST service","quantity":1,"rate":100,"gst_rate":18}]'::jsonb,
    NULL
  );
  IF v.tax_value <> 18 OR v.total <> 118 OR v.cgst <> 9 OR v.sgst <> 9 OR v.igst <> 0 THEN
    RAISE EXCEPTION 'India GST create regression totals incorrect: tax %, total %, CGST %, SGST %',v.tax_value,v.total,v.cgst,v.sgst;
  END IF;
  SELECT * INTO v FROM public.invoices WHERE id=v.id;
  IF v.invoice_snapshot->'items'->0->>'hsnSac' <> '998313' THEN
    RAISE EXCEPTION 'India HSN/SAC snapshot was not retained after invoice reload';
  END IF;
  v := public.save_invoice(
    jsonb_build_object('client_name','India customer','business_name','India seller','issue_date','2026-11-14','currency','INR','tax_mode','igst','tax_rate',18,'discount_type','percent','discount',0,'status','Pending','is_draft',false,
      'invoice_snapshot',v.invoice_snapshot),
    '[{"description":"GST service","quantity":1,"rate":100,"gst_rate":18}]'::jsonb,
    v.id
  );
  IF v.tax_value <> 18 OR v.total <> 118 OR v.cgst <> 0 OR v.sgst <> 0 OR v.igst <> 18 THEN
    RAISE EXCEPTION 'India IGST edit regression totals incorrect: tax %, total %, IGST %',v.tax_value,v.total,v.igst;
  END IF;
  IF v.invoice_snapshot->'items'->0->>'hsnSac' <> '998313' THEN
    RAISE EXCEPTION 'India HSN/SAC snapshot was not preserved during invoice edit';
  END IF;
END
$test$;

SELECT 'PASS: global invoice automatic/manual/inclusive and India GST RPC tests' AS result;
