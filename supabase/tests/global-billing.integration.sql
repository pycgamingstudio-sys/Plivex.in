-- Part 3: isolated PostgreSQL 17 fixture for currency-aware Cashfree billing.
-- Runs only in the disposable CI database; never against the live Supabase project.
BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;
ALTER ROLE service_role BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $fn$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TYPE public.subscription_status AS ENUM ('created','active','failed','tampered');
CREATE TYPE public.subscription_tier AS ENUM ('free','basic','pro');
CREATE TYPE public.payment_outcome AS ENUM ('applied','failed','tampered');

CREATE TABLE public.subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 user_email text,
 workspace_id text,
 plan_id text NOT NULL,
 plan_name text,
 tier public.subscription_tier NOT NULL,
 status public.subscription_status NOT NULL DEFAULT 'created',
 amount integer NOT NULL DEFAULT 0,
 currency text NOT NULL DEFAULT 'INR',
 gateway text NOT NULL DEFAULT 'payu',
 provider text,
 txnid text,
 amount_paise integer,
 provider_payment_id text,
 started_at timestamptz,
 expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.subscriptions (
 user_id,workspace_id,plan_id,plan_name,tier,status,amount,currency,gateway,txnid,amount_paise,started_at,expires_at
) VALUES (
 '30000000-0000-0000-0000-000000000003','ws-india-legacy','basic_yearly','Basic Yearly','basic','active',999,
 'INR','payu','LEGACY-INR-ANNUAL',99900,now()-interval '1 month',now()+interval '11 months'
);

CREATE TABLE public.payment_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid,
 user_email text,
 workspace_id text,
 gateway text NOT NULL DEFAULT 'payu',
 txnid text,
 plan_id text,
 plan_name text,
 tier public.subscription_tier,
 amount integer,
 currency text DEFAULT 'INR',
 status text,
 outcome public.payment_outcome NOT NULL,
 hash_verified boolean NOT NULL DEFAULT false,
 gateway_status text,
 message text,
 source text,
 provider text,
 reason text,
 raw jsonb NOT NULL DEFAULT '{}'::jsonb,
 subscription_id uuid,
 provider_status text,
 provider_payment_id text,
 verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

\ir ../migrations/202611130007_global_billing_and_cashfree_atomicity.sql
\ir ../migrations/202611130008_cashfree_refund_atomicity.sql

-- Prove Migration 009 DDL/ACL changes are fully transactional. This fixture
-- runs only in the disposable CI database. Capture both RPCs after 007/008,
-- apply 009 inside a savepoint, roll it back, and compare definitions/config/ACL.
CREATE TEMP TABLE migration009_before AS
SELECT p.oid::regprocedure::text AS signature,
       pg_get_functiondef(p.oid) AS definition,
       p.proconfig,
       p.proacl,
       p.proowner,
       p.prosecdef
FROM pg_catalog.pg_proc p
WHERE p.oid IN (
 'public.apply_cashfree_subscription_payment(uuid,text,text,bigint,text,text,jsonb,text)'::regprocedure,
 'public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)'::regprocedure
);
DO $before_count$
BEGIN
 IF (SELECT count(*) FROM migration009_before) <> 2 THEN
  RAISE EXCEPTION 'Expected pre-migration snapshots for both billing RPCs';
 END IF;
END
$before_count$;

SAVEPOINT migration009_rollback_probe;
\ir ../migrations/202611130009_global_billing_concurrency_and_definer_hardening.sql
ROLLBACK TO SAVEPOINT migration009_rollback_probe;

DO $rollback_assert$
DECLARE v_mismatches integer;
BEGIN
 SELECT count(*) INTO v_mismatches
 FROM migration009_before b
 JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(b.signature)
 WHERE pg_get_functiondef(p.oid) IS DISTINCT FROM b.definition
    OR p.proconfig IS DISTINCT FROM b.proconfig
    OR p.proacl IS DISTINCT FROM b.proacl
    OR p.proowner IS DISTINCT FROM b.proowner
    OR p.prosecdef IS DISTINCT FROM b.prosecdef;
 IF v_mismatches <> 0 THEN
  RAISE EXCEPTION 'Migration 009 rollback did not restore % RPC definition/config/ACL snapshots',v_mismatches;
 END IF;
 IF (SELECT count(*) FROM migration009_before b
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(b.signature))) <> 0 THEN
  RAISE EXCEPTION 'Migration 009 rollback lost a pre-existing billing RPC';
 END IF;
END
$rollback_assert$;
RELEASE SAVEPOINT migration009_rollback_probe;
\echo 'PASS: Migration 009 rollback restored both RPC definitions, proconfig/search_path, ACL, owner and SECURITY DEFINER state'

-- Apply Migration 009 normally after the rollback probe for the remaining
-- integration scenarios below.
\ir ../migrations/202611130009_global_billing_concurrency_and_definer_hardening.sql
-- Reapply the hardening migration to verify CREATE OR REPLACE/ACL convergence.
\ir ../migrations/202611130009_global_billing_concurrency_and_definer_hardening.sql
-- Prove the new refund-identity migration is transactional and re-applicable.
CREATE TEMP TABLE migration010_before AS
SELECT
  'public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)'::text AS signature,
  pg_get_functiondef('public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)'::regprocedure) AS definition,
  proconfig, proacl, proowner, prosecdef
FROM pg_catalog.pg_proc
WHERE oid = 'public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)'::regprocedure;

SAVEPOINT migration010_rollback_probe;
\ir ../migrations/202611130010_cashfree_refund_identity_immutability.sql
ROLLBACK TO SAVEPOINT migration010_rollback_probe;

DO $migration010_rollback_assert$
DECLARE v_mismatches integer;
BEGIN
 SELECT count(*) INTO v_mismatches
 FROM migration010_before b
 JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(b.signature)
 WHERE pg_get_functiondef(p.oid) IS DISTINCT FROM b.definition
    OR p.proconfig IS DISTINCT FROM b.proconfig
    OR p.proacl IS DISTINCT FROM b.proacl
    OR p.proowner IS DISTINCT FROM b.proowner
    OR p.prosecdef IS DISTINCT FROM b.prosecdef;
 IF v_mismatches <> 0 THEN
   RAISE EXCEPTION 'Migration 010 rollback did not restore refund RPC state';
 END IF;
 IF to_regprocedure('public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)') IS NULL THEN
   RAISE EXCEPTION 'Migration 010 rollback removed the pre-existing refund RPC';
 END IF;
END
$migration010_rollback_assert$;
RELEASE SAVEPOINT migration010_rollback_probe;

-- Apply and reapply normally to prove convergence.
\ir ../migrations/202611130010_cashfree_refund_identity_immutability.sql
\ir ../migrations/202611130010_cashfree_refund_identity_immutability.sql
-- Verify the exact-payment refund RPC migration is transactional and repeatable.
CREATE TEMP TABLE migration011_before AS
SELECT pg_get_functiondef(oid) AS definition, proconfig, proacl, proowner, prosecdef
FROM pg_catalog.pg_proc
WHERE oid = 'public.apply_cashfree_refund_event(uuid,text,text,text,bigint,text,text,jsonb)'::regprocedure;
SAVEPOINT migration011_rollback_probe;
\ir ../migrations/20261114000005_cashfree_refund_exact_payment_mapping.sql
ROLLBACK TO SAVEPOINT migration011_rollback_probe;
DO $migration011_rollback_assert$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM migration011_before b
   JOIN pg_catalog.pg_proc p
     ON p.oid = 'public.apply_cashfree_refund_event(uuid,text,text,text,bigint,text,text,jsonb)'::regprocedure
   WHERE pg_get_functiondef(p.oid)=b.definition
     AND p.proconfig IS NOT DISTINCT FROM b.proconfig
     AND p.proacl IS NOT DISTINCT FROM b.proacl
     AND p.proowner IS NOT DISTINCT FROM b.proowner
     AND p.prosecdef IS NOT DISTINCT FROM b.prosecdef
 ) THEN RAISE EXCEPTION 'Migration 011 rollback did not restore exact-payment RPC state'; END IF;
END
$migration011_rollback_assert$;
RELEASE SAVEPOINT migration011_rollback_probe;
\ir ../migrations/20261114000005_cashfree_refund_exact_payment_mapping.sql
\ir ../migrations/20261114000005_cashfree_refund_exact_payment_mapping.sql
GRANT SELECT ON public.subscriptions TO service_role;

DO $legacy$
DECLARE v_period text; v_payment text; v_minor bigint; v_major numeric; v_start timestamptz; v_expiry timestamptz; v_gateway text;
BEGIN
 SELECT billing_period,payment_status,amount_minor_units,amount_major,started_at,expires_at,gateway
 INTO v_period,v_payment,v_minor,v_major,v_start,v_expiry,v_gateway
 FROM public.subscriptions WHERE txnid='LEGACY-INR-ANNUAL';
 IF v_gateway<>'payu' OR v_period<>'year' OR v_payment<>'success' OR v_minor<>99900 OR v_major<>999 THEN
  RAISE EXCEPTION 'Legacy India PayU payment metadata was not safely preserved/backfilled';
 END IF;
 IF v_start IS NULL OR v_expiry IS NULL OR v_expiry<=v_start THEN
  RAISE EXCEPTION 'Legacy India subscription access dates were changed';
 END IF;
END
$legacy$;

DO $privileges$
BEGIN
 IF has_function_privilege('anon','public.apply_cashfree_subscription_payment(uuid,text,text,bigint,text,text,jsonb,text)','EXECUTE') THEN
  RAISE EXCEPTION 'anon must not execute Cashfree activation RPC';
 END IF;
 IF has_function_privilege('authenticated','public.apply_cashfree_subscription_payment(uuid,text,text,bigint,text,text,jsonb,text)','EXECUTE') THEN
  RAISE EXCEPTION 'authenticated must not execute Cashfree activation RPC';
 END IF;
 IF NOT has_function_privilege('service_role','public.apply_cashfree_subscription_payment(uuid,text,text,bigint,text,text,jsonb,text)','EXECUTE') THEN
  RAISE EXCEPTION 'service_role must execute Cashfree activation RPC';
 END IF;
END
$privileges$;

INSERT INTO public.subscriptions (
 user_id,user_email,workspace_id,plan_id,plan_name,tier,status,amount,amount_minor_units,amount_major,
 currency,country_code,locale_code,billing_period,gateway,provider,txnid,idempotency_key,payment_status
) VALUES (
 '10000000-0000-0000-0000-000000000001','owner@example.test','ws-us',
 'basic_monthly','Basic Monthly','basic','created',6,599,5.99,
 'USD','US','en-US','month','cashfree','cashfree','PLXCF-ORDER000000000000000001',
 'PLXCF-ORDER000000000000000001','created'
);

SET ROLE service_role;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),
 'CFPAY-001','USD',599,'PAID','SUCCESS','{"test":true}'::jsonb,'ci-test'
);
RESET ROLE;

DO $activation$
DECLARE v_status text; v_count integer; v_amount numeric; v_currency text;
BEGIN
 SELECT status::text,amount_major,currency INTO v_status,v_amount,v_currency
 FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001';
 IF v_status<>'active' OR v_amount<>5.99 OR v_currency<>'USD' THEN
  RAISE EXCEPTION 'Verified USD payment did not activate exact subscription amount';
 END IF;
 SELECT count(*) INTO v_count FROM public.payment_logs
 WHERE txnid='PLXCF-ORDER000000000000000001' AND provider_payment_id='CFPAY-001';
 IF v_count<>1 THEN RAISE EXCEPTION 'Expected exactly one payment ledger row, got %',v_count; END IF;
END
$activation$;

-- Replayed provider webhook is idempotent and cannot duplicate the ledger.
SET ROLE service_role;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),
 'CFPAY-001','USD',599,'PAID','SUCCESS','{"test":true}'::jsonb,'ci-replay'
);
RESET ROLE;
DO $replay$
BEGIN
 IF (SELECT count(*) FROM public.payment_logs WHERE provider_payment_id='CFPAY-001')<>1 THEN
  RAISE EXCEPTION 'Duplicate webhook created a second payment log';
 END IF;
END
$replay$;

-- Refund reconciliation is atomic, idempotent and bounded by the paid amount.
SET ROLE service_role;
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),
 'PLXCF-ORDER000000000000000001',
 'CFPAY-001',
 'CFREFUND-001',200,'USD','success','{"test":"partial-1"}'::jsonb
);
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),
 'PLXCF-ORDER000000000000000001',
 'CFPAY-001',
 'CFREFUND-002',300,'USD','success','{"test":"partial-2"}'::jsonb
);
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),
 'PLXCF-ORDER000000000000000001',
 'CFPAY-001',
 'CFREFUND-002',300,'USD','success','{"test":"partial-2-replay"}'::jsonb
);
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),
 'PLXCF-ORDER000000000000000001',
 'CFPAY-001',
 'CFREFUND-OVER',100,'USD','success','{"test":"over-refund"}'::jsonb
);
RESET ROLE;
DO $partial_refunds$
DECLARE v_total bigint; v_status text; v_payment text; v_count integer;
BEGIN
 SELECT COALESCE(sum(amount_minor_units),0) INTO v_total FROM public.payment_refunds
 WHERE subscription_id=(SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001') AND status='success';
 IF v_total<>500 THEN RAISE EXCEPTION 'Expected 500 minor units after two partial refunds and replay; got %',v_total; END IF;
 SELECT count(*) INTO v_count FROM public.payment_refunds WHERE provider_refund_id='CFREFUND-002';
 IF v_count<>1 THEN RAISE EXCEPTION 'Refund replay duplicated ledger row'; END IF;
 SELECT status::text,payment_status INTO v_status,v_payment FROM public.subscriptions
 WHERE txnid='PLXCF-ORDER000000000000000001';
 IF v_status<>'active' OR v_payment<>'partially_refunded' THEN
  RAISE EXCEPTION 'Partial refund must preserve active paid access';
 END IF;
 IF EXISTS (SELECT 1 FROM public.payment_refunds WHERE provider_refund_id='CFREFUND-OVER') THEN
  RAISE EXCEPTION 'Over-refund event was incorrectly recorded';
 END IF;
END
$partial_refunds$;

SET ROLE service_role;
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),
 'PLXCF-ORDER000000000000000001',
 'CFPAY-001',
 'CFREFUND-003',99,'USD','success','{"test":"final-refund"}'::jsonb
);
RESET ROLE;
DO $full_refund$
DECLARE v_status text; v_payment text; v_total bigint;
BEGIN
 SELECT status::text,payment_status INTO v_status,v_payment FROM public.subscriptions
 WHERE txnid='PLXCF-ORDER000000000000000001';
 SELECT sum(amount_minor_units) INTO v_total FROM public.payment_refunds
 WHERE subscription_id=(SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001') AND status='success';
 IF v_status<>'failed' OR v_payment<>'refunded' OR v_total<>599 THEN
  RAISE EXCEPTION 'Full refund did not revoke access and reconcile exact amount';
 END IF;
END
$full_refund$;

-- Wrong amount/currency never activates the order.
INSERT INTO public.subscriptions (
 user_id,workspace_id,plan_id,tier,status,amount,amount_minor_units,amount_major,currency,country_code,locale_code,
 billing_period,gateway,provider,txnid,idempotency_key
) VALUES (
 '10000000-0000-0000-0000-000000000001','ws-us','pro_monthly','pro','created',10,999,9.99,
 'USD','US','en-US','month','cashfree','cashfree','PLXCF-ORDER000000000000000002','PLXCF-ORDER000000000000000002'
);
SET ROLE service_role;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000002'),
 'CFPAY-002','USD',1000,'PAID','SUCCESS','{}'::jsonb,'ci-mismatch'
);
RESET ROLE;
DO $mismatch$
BEGIN
 IF (SELECT status::text FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000002')<>'created' THEN
  RAISE EXCEPTION 'Mismatched amount unexpectedly activated subscription';
 END IF;
END
$mismatch$;

-- A correct amount in the wrong currency must also be rejected.
INSERT INTO public.subscriptions (
 user_id,workspace_id,plan_id,tier,status,amount,amount_minor_units,amount_major,
 currency,country_code,locale_code,billing_period,gateway,provider,txnid
) VALUES (
 '10000000-0000-0000-0000-000000000001','ws-us','basic_monthly','basic','created',6,599,5.99,
 'USD','US','en-US','month','cashfree','cashfree','PLXCF-ORDER000000000000000003'
);
SET ROLE service_role;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000003'),
 'CFPAY-003','CAD',599,'PAID','SUCCESS','{}'::jsonb,'ci-currency-mismatch'
);
RESET ROLE;
DO $currency_mismatch$
BEGIN
 IF (SELECT status::text FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000003')<>'created' THEN
  RAISE EXCEPTION 'Mismatched currency unexpectedly activated subscription';
 END IF;
 IF EXISTS (SELECT 1 FROM public.payment_logs WHERE provider_payment_id='CFPAY-003') THEN
  RAISE EXCEPTION 'Mismatched currency created a payment ledger row';
 END IF;
END
$currency_mismatch$;


-- A lower-tier purchase is queued after the existing higher-tier paid period.
INSERT INTO public.subscriptions (
 user_id,workspace_id,plan_id,tier,status,amount,amount_minor_units,amount_major,currency,country_code,locale_code,
 billing_period,gateway,provider,txnid,started_at,expires_at
) VALUES (
 '10000000-0000-0000-0000-000000000001','ws-downgrade','pro_monthly','pro','active',9,999,9.99,
 'USD','US','en-US','month','cashfree','cashfree','PRIOR-PRO',
 now(),now()+interval '10 days'
);
INSERT INTO public.subscriptions (
 user_id,workspace_id,plan_id,tier,status,amount,amount_minor_units,amount_major,currency,country_code,locale_code,
 billing_period,gateway,provider,txnid
) VALUES (
 '10000000-0000-0000-0000-000000000001','ws-downgrade','basic_monthly','basic','created',6,599,5.99,
 'USD','US','en-US','month','cashfree','cashfree','PLXCF-DOWNGRADE0000000000000001'
);
SET ROLE service_role;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-DOWNGRADE0000000000000001'),
 'CFPAY-DOWNGRADE','USD',599,'PAID','SUCCESS','{}'::jsonb,'ci-downgrade'
);
RESET ROLE;
DO $downgrade$
DECLARE v_start timestamptz; v_pro_end timestamptz;
BEGIN
 SELECT started_at INTO v_start FROM public.subscriptions WHERE txnid='PLXCF-DOWNGRADE0000000000000001';
 SELECT expires_at INTO v_pro_end FROM public.subscriptions WHERE txnid='PRIOR-PRO';
 IF v_start < v_pro_end THEN RAISE EXCEPTION 'Basic downgrade started before Pro expiry'; END IF;
END
$downgrade$;


-- Reusing one provider payment ID for a different order must be rejected.
INSERT INTO public.subscriptions (
 user_id,workspace_id,plan_id,tier,status,amount,amount_minor_units,amount_major,currency,country_code,locale_code,
 billing_period,gateway,provider,txnid
) VALUES (
 '10000000-0000-0000-0000-000000000001','ws-other-order','basic_monthly','basic','created',6,599,5.99,
 'USD','US','en-US','month','cashfree','cashfree','PLXCF-REUSED-PAYMENT000000000001'
);
SET ROLE service_role;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-REUSED-PAYMENT000000000001'),
 'CFPAY-001','USD',599,'PAID','SUCCESS','{}'::jsonb,'ci-reused-payment'
);
RESET ROLE;
DO $reuse$
BEGIN
 IF (SELECT status::text FROM public.subscriptions WHERE txnid='PLXCF-REUSED-PAYMENT000000000001')<>'created' THEN
  RAISE EXCEPTION 'A provider payment ID was reused for another subscription';
 END IF;
END
$reuse$;

-- A same-tier renewal extends from the existing paid expiry rather than resetting time.
INSERT INTO public.subscriptions (
 user_id,workspace_id,plan_id,tier,status,amount,amount_minor_units,amount_major,currency,country_code,locale_code,
 billing_period,gateway,provider,txnid,started_at,expires_at
) VALUES (
 '10000000-0000-0000-0000-000000000001','ws-renew','basic_monthly','basic','active',6,599,5.99,
 'USD','US','en-US','month','cashfree','cashfree','PRIOR-BASIC-RENEW',
 now(),now()+interval '5 days'
);
INSERT INTO public.subscriptions (
 user_id,workspace_id,plan_id,tier,status,amount,amount_minor_units,amount_major,currency,country_code,locale_code,
 billing_period,gateway,provider,txnid
) VALUES (
 '10000000-0000-0000-0000-000000000001','ws-renew','basic_monthly','basic','created',6,599,5.99,
 'USD','US','en-US','month','cashfree','cashfree','PLXCF-BASIC-RENEW0000000000001'
);
SET ROLE service_role;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-BASIC-RENEW0000000000001'),
 'CFPAY-BASIC-RENEW','USD',599,'PAID','SUCCESS','{}'::jsonb,'ci-renew'
);
RESET ROLE;
DO $renew$
DECLARE v_start timestamptz; v_previous_end timestamptz;
BEGIN
 SELECT started_at INTO v_start FROM public.subscriptions WHERE txnid='PLXCF-BASIC-RENEW0000000000001';
 SELECT expires_at INTO v_previous_end FROM public.subscriptions WHERE txnid='PRIOR-BASIC-RENEW';
 IF v_start < v_previous_end THEN RAISE EXCEPTION 'Basic renewal reset or overlapped the existing paid period'; END IF;
END
$renew$;

-- Refund rows are visible only to their owning user.
INSERT INTO public.payment_refunds (
 subscription_id,user_id,workspace_id,provider,provider_refund_id,amount_minor_units,currency,status
) VALUES
 ((SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),'10000000-0000-0000-0000-000000000001','ws-us','cashfree','REFUND-OWN',100,'USD','success'),
 ((SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),'20000000-0000-0000-0000-000000000002','ws-other','cashfree','REFUND-OTHER',100,'USD','success');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SET ROLE authenticated;
DO $refund_rls$
DECLARE v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM public.payment_refunds;
 IF v_count<>4 THEN RAISE EXCEPTION 'Refund RLS exposed % rows instead of four owned refunds',v_count; END IF;
END
$refund_rls$;
RESET ROLE;


-- A legacy/user-scoped subscription without workspace_id must retain its paid
-- period when a later Cashfree renewal is applied.
INSERT INTO public.subscriptions (
 user_id,user_email,workspace_id,plan_id,plan_name,tier,status,amount,amount_minor_units,amount_major,
 currency,country_code,locale_code,billing_period,gateway,provider,txnid,started_at,expires_at
) VALUES (
 '40000000-0000-0000-0000-000000000004','null-workspace@example.test',NULL,
 'basic_monthly','Basic Monthly','basic','active',6,599,5.99,
 'USD','US','en-US','month','cashfree','cashfree','PRIOR-NULL-WORKSPACE',
 now(),now()+interval '5 days'
);
INSERT INTO public.subscriptions (
 user_id,user_email,workspace_id,plan_id,plan_name,tier,status,amount,amount_minor_units,amount_major,
 currency,country_code,locale_code,billing_period,gateway,provider,txnid
) VALUES (
 '40000000-0000-0000-0000-000000000004','null-workspace@example.test',NULL,
 'basic_monthly','Basic Monthly','basic','created',6,599,5.99,
 'USD','US','en-US','month','cashfree','cashfree','ORDER-NULL-WORKSPACE'
);
SET ROLE service_role;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='ORDER-NULL-WORKSPACE'),
 'CFPAY-NULL-WORKSPACE','USD',599,'PAID','SUCCESS','{}'::jsonb,'ci-null-workspace'
);
RESET ROLE;
DO $null_workspace_renewal$
DECLARE v_start timestamptz; v_previous_end timestamptz;
BEGIN
 SELECT started_at INTO v_start FROM public.subscriptions WHERE txnid='ORDER-NULL-WORKSPACE';
 SELECT expires_at INTO v_previous_end FROM public.subscriptions WHERE txnid='PRIOR-NULL-WORKSPACE';
 IF v_start IS NULL OR v_previous_end IS NULL OR v_start < v_previous_end THEN
  RAISE EXCEPTION 'NULL workspace renewal lost prior paid duration: start %, prior expiry %',
    v_start,v_previous_end;
 END IF;
END
$null_workspace_renewal$;


-- Cross-user isolation for NULL workspace IDs. A and B each have their own
-- paid expiry; renewing one user must not consume or mutate the other's term.
INSERT INTO public.subscriptions (
 user_id,user_email,workspace_id,plan_id,plan_name,tier,status,amount,amount_minor_units,amount_major,
 currency,country_code,locale_code,billing_period,gateway,provider,txnid,started_at,expires_at
) VALUES
 ('50000000-0000-0000-0000-000000000005','user-a@example.test',NULL,'basic_monthly','Basic Monthly','basic','active',6,599,5.99,
  'USD','US','en-US','month','cashfree','cashfree','PRIOR-NULL-A',now(),now()+interval '10 days'),
 ('60000000-0000-0000-0000-000000000006','user-b@example.test',NULL,'basic_monthly','Basic Monthly','basic','active',6,599,5.99,
  'USD','US','en-US','month','cashfree','cashfree','PRIOR-NULL-B',now(),now()+interval '20 days');

CREATE TEMP TABLE null_workspace_baseline AS
SELECT txnid, user_id, started_at, expires_at
FROM public.subscriptions WHERE txnid IN ('PRIOR-NULL-A','PRIOR-NULL-B');

INSERT INTO public.subscriptions (
 user_id,user_email,workspace_id,plan_id,plan_name,tier,status,amount,amount_minor_units,amount_major,
 currency,country_code,locale_code,billing_period,gateway,provider,txnid
) VALUES
 ('50000000-0000-0000-0000-000000000005','user-a@example.test',NULL,'basic_monthly','Basic Monthly','basic','created',6,599,5.99,
  'USD','US','en-US','month','cashfree','cashfree','ORDER-NULL-A'),
 ('60000000-0000-0000-0000-000000000006','user-b@example.test',NULL,'basic_monthly','Basic Monthly','basic','created',6,599,5.99,
  'USD','US','en-US','month','cashfree','cashfree','ORDER-NULL-B');

SET ROLE service_role;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='ORDER-NULL-A'),
 'CFPAY-NULL-A','USD',599,'PAID','SUCCESS','{}'::jsonb,'ci-null-user-a'
);
RESET ROLE;

DO $null_workspace_cross_user_a$
DECLARE
 v_a_prior timestamptz; v_a_start timestamptz; v_a_expiry timestamptz;
 v_b_start timestamptz; v_b_expiry timestamptz;
BEGIN
 SELECT expires_at INTO v_a_prior FROM public.subscriptions WHERE txnid='PRIOR-NULL-A';
 SELECT started_at,expires_at INTO v_a_start,v_a_expiry FROM public.subscriptions WHERE txnid='ORDER-NULL-A';
 SELECT started_at,expires_at INTO v_b_start,v_b_expiry FROM public.subscriptions WHERE txnid='PRIOR-NULL-B';
 IF v_a_start IS DISTINCT FROM v_a_prior OR v_a_expiry IS DISTINCT FROM v_a_prior + interval '1 month' THEN
  RAISE EXCEPTION 'User A renewal did not extend exactly from User A expiry';
 END IF;
 IF v_b_start IS DISTINCT FROM (SELECT started_at FROM null_workspace_baseline WHERE txnid='PRIOR-NULL-B')
    OR v_b_expiry IS DISTINCT FROM (SELECT expires_at FROM null_workspace_baseline WHERE txnid='PRIOR-NULL-B') THEN
  RAISE EXCEPTION 'User A renewal changed User B subscription or expiry';
 END IF;
END
$null_workspace_cross_user_a$;

SET ROLE service_role;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='ORDER-NULL-B'),
 'CFPAY-NULL-B','USD',599,'PAID','SUCCESS','{}'::jsonb,'ci-null-user-b'
);
RESET ROLE;

DO $null_workspace_cross_user_b$
DECLARE
 v_a_start timestamptz; v_a_expiry timestamptz;
 v_b_prior timestamptz; v_b_start timestamptz; v_b_expiry timestamptz;
BEGIN
 SELECT started_at,expires_at INTO v_a_start,v_a_expiry FROM public.subscriptions WHERE txnid='ORDER-NULL-A';
 SELECT expires_at INTO v_b_prior FROM public.subscriptions WHERE txnid='PRIOR-NULL-B';
 SELECT started_at,expires_at INTO v_b_start,v_b_expiry FROM public.subscriptions WHERE txnid='ORDER-NULL-B';
 IF v_b_start IS DISTINCT FROM v_b_prior OR v_b_expiry IS DISTINCT FROM v_b_prior + interval '1 month' THEN
  RAISE EXCEPTION 'User B renewal did not extend exactly from User B expiry';
 END IF;
 IF v_a_start IS DISTINCT FROM (SELECT expires_at FROM null_workspace_baseline WHERE txnid='PRIOR-NULL-A')
    OR v_a_expiry IS DISTINCT FROM (SELECT expires_at FROM null_workspace_baseline WHERE txnid='PRIOR-NULL-A') + interval '1 month' THEN
  RAISE EXCEPTION 'User B renewal changed User A subscription or expiry';
 END IF;
END
$null_workspace_cross_user_b$;

-- A subscription with two successful Cashfree payments must reconcile each
-- refund against exactly the provider payment ID supplied by Cashfree.
INSERT INTO public.subscriptions (
 user_id,user_email,workspace_id,plan_id,plan_name,tier,status,amount,amount_minor_units,amount_major,
 currency,country_code,locale_code,billing_period,gateway,provider,txnid,payment_status
) VALUES (
 '80000000-0000-0000-0000-000000000008','multi-refund@example.test','ws-multi-refund',
 'basic_monthly','Basic Monthly','basic','active',10,1000,10.00,
 'USD','US','en-US','month','cashfree','cashfree','MULTI-REFUND-ORDER','success'
);
INSERT INTO public.payment_logs (
 user_id,workspace_id,gateway,txnid,plan_id,tier,amount,currency,status,outcome,
 provider,subscription_id,provider_payment_id,amount_minor_units,amount_major
) VALUES
 ('80000000-0000-0000-0000-000000000008','ws-multi-refund','cashfree','MULTI-REFUND-ORDER',
  'basic_monthly','basic',600,'USD','success','applied','cashfree',
  (SELECT id FROM public.subscriptions WHERE txnid='MULTI-REFUND-ORDER'),'CFPAY-MULTI-A',600,6.00),
 ('80000000-0000-0000-0000-000000000008','ws-multi-refund','cashfree','MULTI-REFUND-ORDER',
  'basic_monthly','basic',400,'USD','success','applied','cashfree',
  (SELECT id FROM public.subscriptions WHERE txnid='MULTI-REFUND-ORDER'),'CFPAY-MULTI-B',400,4.00);
SET ROLE service_role;
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='MULTI-REFUND-ORDER'),
 'MULTI-REFUND-ORDER','CFPAY-MULTI-A','CFREFUND-MULTI-A',300,'USD','success','{"test":"multi-a"}'::jsonb
);
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='MULTI-REFUND-ORDER'),
 'MULTI-REFUND-ORDER','CFPAY-MULTI-B','CFREFUND-MULTI-B',200,'USD','success','{"test":"multi-b"}'::jsonb
);
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='MULTI-REFUND-ORDER'),
 'MULTI-REFUND-ORDER','CFPAY-MULTI-A','CFREFUND-MULTI-A',300,'USD','success','{"test":"multi-a-replay"}'::jsonb
);
RESET ROLE;
DO $multi_payment_refunds$
DECLARE v_a uuid; v_b uuid; v_total bigint; v_a_refund bigint; v_b_refund bigint;
BEGIN
 SELECT id INTO v_a FROM public.payment_logs WHERE provider_payment_id='CFPAY-MULTI-A';
 SELECT id INTO v_b FROM public.payment_logs WHERE provider_payment_id='CFPAY-MULTI-B';
 SELECT sum(amount_minor_units) INTO v_total FROM public.payment_refunds
 WHERE subscription_id=(SELECT id FROM public.subscriptions WHERE txnid='MULTI-REFUND-ORDER') AND status='success';
 SELECT refund_amount_minor_units INTO v_a_refund FROM public.payment_logs WHERE id=v_a;
 SELECT refund_amount_minor_units INTO v_b_refund FROM public.payment_logs WHERE id=v_b;
 IF v_total<>500 OR v_a_refund<>300 OR v_b_refund<>200 THEN
   RAISE EXCEPTION 'Per-payment/subscription refund totals incorrect: total %, A %, B %',v_total,v_a_refund,v_b_refund;
 END IF;
 IF (SELECT payment_log_id FROM public.payment_refunds WHERE provider_refund_id='CFREFUND-MULTI-A') IS DISTINCT FROM v_a
    OR (SELECT payment_log_id FROM public.payment_refunds WHERE provider_refund_id='CFREFUND-MULTI-B') IS DISTINCT FROM v_b THEN
   RAISE EXCEPTION 'Refund rows were not linked to their exact originating payment logs';
 END IF;
 IF (SELECT status::text FROM public.subscriptions WHERE txnid='MULTI-REFUND-ORDER')<>'active'
    OR (SELECT payment_status FROM public.subscriptions WHERE txnid='MULTI-REFUND-ORDER')<>'partially_refunded' THEN
   RAISE EXCEPTION 'Partial aggregate refund must preserve paid subscription access';
 END IF;
END
$multi_payment_refunds$;
DO $missing_payment_mapping$
DECLARE v_result jsonb;
BEGIN
 v_result := public.apply_cashfree_refund_event(
  (SELECT id FROM public.subscriptions WHERE txnid='MULTI-REFUND-ORDER'),
  'MULTI-REFUND-ORDER','CFPAY-NOT-FOUND','CFREFUND-MISSING',10,'USD','success','{}'::jsonb
 );
 IF v_result->>'reason'<>'payment_log_not_found' THEN
   RAISE EXCEPTION 'Unknown provider payment ID was not rejected: %',v_result;
 END IF;
 v_result := public.apply_cashfree_refund_event(
  (SELECT id FROM public.subscriptions WHERE txnid='MULTI-REFUND-ORDER'),
  'WRONG-ORDER','CFPAY-MULTI-A','CFREFUND-WRONG-ORDER',10,'USD','success','{}'::jsonb
 );
 IF v_result->>'reason'<>'refund_order_mismatch' THEN
   RAISE EXCEPTION 'Mismatched Cashfree order ID was not rejected: %',v_result;
 END IF;
END
$missing_payment_mapping$;

-- Existing unlinked history is never silently assigned to an arbitrary payment.
INSERT INTO public.subscriptions (
 user_id,workspace_id,plan_id,tier,status,amount,amount_minor_units,amount_major,currency,country_code,
 locale_code,billing_period,gateway,provider,txnid,payment_status
) VALUES (
 '90000000-0000-0000-0000-000000000009','ws-unlinked','basic_monthly','basic','active',5,500,5.00,
 'USD','US','en-US','month','cashfree','cashfree','UNLINKED-REFUND-ORDER','success'
);
INSERT INTO public.payment_logs (
 user_id,workspace_id,gateway,txnid,plan_id,tier,amount,currency,status,outcome,provider,
 subscription_id,provider_payment_id,amount_minor_units,amount_major
) VALUES (
 '90000000-0000-0000-0000-000000000009','ws-unlinked','cashfree','UNLINKED-REFUND-ORDER',
 'basic_monthly','basic',500,'USD','success','applied','cashfree',
 (SELECT id FROM public.subscriptions WHERE txnid='UNLINKED-REFUND-ORDER'),'CFPAY-UNLINKED',500,5.00
);
INSERT INTO public.payment_refunds (
 subscription_id,user_id,workspace_id,provider,provider_refund_id,amount_minor_units,currency,status
) VALUES (
 (SELECT id FROM public.subscriptions WHERE txnid='UNLINKED-REFUND-ORDER'),
 '90000000-0000-0000-0000-000000000009','ws-unlinked','cashfree','HISTORICAL-UNLINKED',50,'USD','success'
);
DO $historical_unlinked_fail_closed$
DECLARE v_result jsonb;
BEGIN
 v_result := public.apply_cashfree_refund_event(
  (SELECT id FROM public.subscriptions WHERE txnid='UNLINKED-REFUND-ORDER'),
  'UNLINKED-REFUND-ORDER','CFPAY-UNLINKED','CFREFUND-AFTER-UNLINKED',50,'USD','success','{}'::jsonb
 );
 IF v_result->>'reason'<>'historical_unlinked_refund' THEN
   RAISE EXCEPTION 'Historical unlinked refund did not fail closed: %',v_result;
 END IF;
END
$historical_unlinked_fail_closed$;


-- Refund ID amount/currency are immutable in every lifecycle state.
INSERT INTO public.subscriptions (
 user_id,user_email,workspace_id,plan_id,plan_name,tier,status,amount,amount_minor_units,amount_major,
 currency,country_code,locale_code,billing_period,gateway,provider,txnid
) VALUES (
 '70000000-0000-0000-0000-000000000007','refund-immutable@example.test','ws-refund-immutable',
 'basic_monthly','Basic Monthly','basic','active',5,500,5.00,
 'USD','US','en-US','month','cashfree','cashfree','REFUND-IMMUTABLE-ORDER'
);
INSERT INTO public.payment_logs (
 user_id,workspace_id,gateway,txnid,plan_id,tier,amount,currency,status,outcome,
 provider,subscription_id,provider_payment_id,amount_minor_units,amount_major
) VALUES (
 '70000000-0000-0000-0000-000000000007','ws-refund-immutable','cashfree','REFUND-IMMUTABLE-ORDER',
 'basic_monthly','basic',500,'USD','success','applied','cashfree',
 (SELECT id FROM public.subscriptions WHERE txnid='REFUND-IMMUTABLE-ORDER'),
 'CFPAY-REFUND-IMMUTABLE',500,5.00
);

-- First pending event establishes the immutable provider refund amount/currency.
SET ROLE service_role;
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='REFUND-IMMUTABLE-ORDER'),
 'REFUND-IMMUTABLE-ORDER',
 'CFPAY-REFUND-IMMUTABLE',
 'CFREFUND-IMMUTABLE',100,'USD','pending','{"test":"pending"}'::jsonb
);
RESET ROLE;

DO $refund_pending_immutability$
DECLARE v_result jsonb;
BEGIN
 v_result := public.apply_cashfree_refund_event(
   (SELECT id FROM public.subscriptions WHERE txnid='REFUND-IMMUTABLE-ORDER'),
   'REFUND-IMMUTABLE-ORDER',
   'CFPAY-REFUND-IMMUTABLE',
   'CFREFUND-IMMUTABLE',101,'USD','pending','{"test":"pending-amount-mismatch"}'::jsonb
 );
 IF v_result->>'reason' <> 'refund_amount_conflict' THEN
   RAISE EXCEPTION 'Pending refund amount mismatch was not rejected: %',v_result;
 END IF;
 v_result := public.apply_cashfree_refund_event(
   (SELECT id FROM public.subscriptions WHERE txnid='REFUND-IMMUTABLE-ORDER'),
   'REFUND-IMMUTABLE-ORDER',
   'CFPAY-REFUND-IMMUTABLE',
   'CFREFUND-IMMUTABLE',100,'CAD','pending','{"test":"pending-currency-mismatch"}'::jsonb
 );
 IF v_result->>'reason' <> 'refund_amount_conflict' THEN
   RAISE EXCEPTION 'Pending refund currency mismatch was not rejected as conflict: %',v_result;
 END IF;
END
$refund_pending_immutability$;

-- The same amount/currency may progress pending -> failed -> success.
SET ROLE service_role;
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='REFUND-IMMUTABLE-ORDER'),
 'REFUND-IMMUTABLE-ORDER',
 'CFPAY-REFUND-IMMUTABLE',
 'CFREFUND-IMMUTABLE',100,'USD','failed','{"test":"failed"}'::jsonb
);
RESET ROLE;

DO $refund_failed_immutability$
DECLARE v_result jsonb;
BEGIN
 v_result := public.apply_cashfree_refund_event(
   (SELECT id FROM public.subscriptions WHERE txnid='REFUND-IMMUTABLE-ORDER'),
   'REFUND-IMMUTABLE-ORDER',
   'CFPAY-REFUND-IMMUTABLE',
   'CFREFUND-IMMUTABLE',102,'USD','failed','{"test":"failed-amount-mismatch"}'::jsonb
 );
 IF v_result->>'reason' <> 'refund_amount_conflict' THEN
   RAISE EXCEPTION 'Failed refund amount mismatch was not rejected: %',v_result;
 END IF;
 v_result := public.apply_cashfree_refund_event(
   (SELECT id FROM public.subscriptions WHERE txnid='REFUND-IMMUTABLE-ORDER'),
   'REFUND-IMMUTABLE-ORDER',
   'CFPAY-REFUND-IMMUTABLE',
   'CFREFUND-IMMUTABLE',100,'CAD','failed','{"test":"failed-currency-mismatch"}'::jsonb
 );
 IF v_result->>'reason' <> 'refund_amount_conflict' THEN
   RAISE EXCEPTION 'Failed refund currency mismatch was not rejected: %',v_result;
 END IF;
END
$refund_failed_immutability$;

SET ROLE service_role;
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='REFUND-IMMUTABLE-ORDER'),
 'REFUND-IMMUTABLE-ORDER',
 'CFPAY-REFUND-IMMUTABLE',
 'CFREFUND-IMMUTABLE',100,'USD','success','{"test":"success"}'::jsonb
);
RESET ROLE;

DO $refund_final_immutability$
DECLARE v_result jsonb;
BEGIN
 v_result := public.apply_cashfree_refund_event(
   (SELECT id FROM public.subscriptions WHERE txnid='REFUND-IMMUTABLE-ORDER'),
   'REFUND-IMMUTABLE-ORDER',
   'CFPAY-REFUND-IMMUTABLE',
   'CFREFUND-IMMUTABLE',99,'USD','success','{"test":"success-amount-mismatch"}'::jsonb
 );
 IF v_result->>'reason' <> 'refund_amount_conflict' THEN
   RAISE EXCEPTION 'Successful refund amount mismatch was not rejected: %',v_result;
 END IF;
 v_result := public.apply_cashfree_refund_event(
   (SELECT id FROM public.subscriptions WHERE txnid='REFUND-IMMUTABLE-ORDER'),
   'REFUND-IMMUTABLE-ORDER',
   'CFPAY-REFUND-IMMUTABLE',
   'CFREFUND-IMMUTABLE',100,'GBP','success','{"test":"success-currency-mismatch"}'::jsonb
 );
 IF v_result->>'reason' <> 'refund_amount_conflict' THEN
   RAISE EXCEPTION 'Successful refund currency mismatch was not rejected as conflict: %',v_result;
 END IF;
 IF (SELECT amount_minor_units FROM public.payment_refunds WHERE provider_refund_id='CFREFUND-IMMUTABLE') <> 100
    OR (SELECT currency FROM public.payment_refunds WHERE provider_refund_id='CFREFUND-IMMUTABLE') <> 'USD' THEN
   RAISE EXCEPTION 'Refund ledger monetary identity changed after mismatch attempts';
 END IF;
END
$refund_final_immutability$;

ROLLBACK;
