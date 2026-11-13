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
GRANT SELECT ON public.subscriptions TO service_role;

DO $legacy$
DECLARE v_period text; v_payment text; v_minor bigint; v_major numeric; v_start timestamptz; v_expiry timestamptz;
BEGIN
 SELECT billing_period,payment_status,amount_minor_units,amount_major,started_at,expires_at
 INTO v_period,v_payment,v_minor,v_major,v_start,v_expiry
 FROM public.subscriptions WHERE txnid='LEGACY-INR-ANNUAL';
 IF v_period<>'year' OR v_payment<>'success' OR v_minor<>99900 OR v_major<>999 THEN
  RAISE EXCEPTION 'Legacy India subscription metadata was not safely backfilled';
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
 'CFREFUND-001',200,'USD','success','{"test":"partial-1"}'::jsonb
);
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),
 'CFREFUND-002',300,'USD','success','{"test":"partial-2"}'::jsonb
);
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),
 'CFREFUND-002',300,'USD','success','{"test":"partial-2-replay"}'::jsonb
);
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='PLXCF-ORDER000000000000000001'),
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

ROLLBACK;
