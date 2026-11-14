\set ON_ERROR_STOP on

-- Disposable PostgreSQL fixture for the India Cashfree refund migration.
-- This script is run only against the ephemeral PostgreSQL service in CI.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$$;

CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  workspace_id text,
  txnid text NOT NULL,
  status text NOT NULL,
  updated_at timestamptz,
  amount integer,
  amount_paise bigint,
  currency text,
  gateway text,
  provider text
);

CREATE TABLE public.payment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid,
  provider text
);

INSERT INTO public.subscriptions
  (id,user_id,workspace_id,txnid,status,amount,amount_paise,currency,gateway,provider)
VALUES
  ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','PLXCF-PARTIAL-000000000000000001','active',100,10000,'INR','cashfree','cashfree'),
  ('10000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','ws-b','PLXCF-FULL-00000000000000000002','active',100,10000,'INR','cashfree','cashfree'),
  ('10000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','PLXCF-REPLAY-000000000000000003','active',100,10000,'INR','cashfree','cashfree'),
  ('10000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','PLXCF-CURRENCY-0000000000000004','active',100,10000,'INR','cashfree','cashfree'),
  ('10000000-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','PLXCF-OVER-00000000000000000005','active',100,10000,'INR','cashfree','cashfree'),
  ('10000000-0000-0000-0000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','PLXCF-CUMULATIVE-000000000000006','active',100,10000,'INR','cashfree','cashfree'),
  ('10000000-0000-0000-0000-000000000007','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','PLXCF-TRANSITION-000000000000007','active',100,10000,'INR','cashfree','cashfree'),
  ('10000000-0000-0000-0000-000000000008','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','PLXCF-SERVICE-000000000000000008','active',100,10000,'INR','cashfree','cashfree'),
  ('10000000-0000-0000-0000-000000000009','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','PLXCF-CONCURRENT-000000000000000009','active',100,10000,'INR','cashfree','cashfree'),
  ('10000000-0000-0000-0000-000000000010','cccccccc-cccc-cccc-cccc-cccccccccccc','ws-c','PLX-PHONEPE-LEGACY-0000000000000010','active',200,20000,'INR','phonepe','phonepe');

INSERT INTO public.payment_logs (subscription_id,provider)
SELECT id, provider FROM public.subscriptions;

-- Apply the real migration, then replay it once before any refund events.
\ir ../migrations/20261114000000_india_cashfree_refund_support.sql
\ir ../migrations/20261114000000_india_cashfree_refund_support.sql

DO $$
DECLARE
  v jsonb;
  v_count integer;
  v_minor bigint;
  v_status text;
BEGIN
  -- Partial refund.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000001','RF-PARTIAL',3000,'INR','success','{}'::jsonb
  );
  IF v->>'ok' <> 'true' OR (v->>'refunded_minor_units')::bigint <> 3000
     OR v->>'refund_status' <> 'partially_refunded' THEN
    RAISE EXCEPTION 'Partial refund failed: %', v;
  END IF;

  -- Full refund.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000002','RF-FULL',10000,'INR','success','{}'::jsonb
  );
  IF v->>'ok' <> 'true' OR v->>'fully_refunded' <> 'true' THEN
    RAISE EXCEPTION 'Full refund failed: %', v;
  END IF;
  SELECT status INTO v_status FROM public.subscriptions
   WHERE id='10000000-0000-0000-0000-000000000002';
  IF v_status <> 'failed' THEN RAISE EXCEPTION 'Full refund did not close subscription'; END IF;

  -- Same refund ID replay is idempotent.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000001','RF-PARTIAL',3000,'INR','success','{}'::jsonb
  );
  IF v->>'ok' <> 'true' OR v->>'already_applied' <> 'true' THEN
    RAISE EXCEPTION 'Refund replay was not idempotent: %', v;
  END IF;

  -- Same ID with a changed amount is rejected.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000001','RF-PARTIAL',3100,'INR','success','{}'::jsonb
  );
  IF v->>'reason' <> 'refund_amount_conflict' THEN
    RAISE EXCEPTION 'Changed refund amount was not rejected: %', v;
  END IF;

  -- Same provider refund ID cannot be reused on another subscription.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000003','RF-PARTIAL',3000,'INR','success','{}'::jsonb
  );
  IF v->>'reason' <> 'refund_id_already_used' THEN
    RAISE EXCEPTION 'Cross-subscription duplicate refund ID was not rejected: %', v;
  END IF;

  -- Currency mismatch.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000004','RF-CURRENCY',1000,'USD','success','{}'::jsonb
  );
  IF v->>'reason' <> 'refund_order_mismatch' THEN
    RAISE EXCEPTION 'Currency mismatch was not rejected: %', v;
  END IF;

  -- A single refund cannot exceed the original payment.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000005','RF-OVER',10001,'INR','success','{}'::jsonb
  );
  IF v->>'reason' <> 'refund_amount_invalid' THEN
    RAISE EXCEPTION 'Single over-refund was not rejected: %', v;
  END IF;

  -- Cumulative successful refunds cannot exceed the original payment.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000006','RF-CUM-1',6000,'INR','success','{}'::jsonb
  );
  IF v->>'ok' <> 'true' THEN RAISE EXCEPTION 'First cumulative refund failed: %', v; END IF;
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000006','RF-CUM-2',5000,'INR','success','{}'::jsonb
  );
  IF v->>'reason' <> 'cumulative_refund_exceeds_payment' THEN
    RAISE EXCEPTION 'Cumulative over-refund was not rejected: %', v;
  END IF;

  -- Pending -> failed -> success is a permitted forward transition.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000007','RF-TRANSITION',2000,'INR','pending','{}'::jsonb
  );
  IF v->>'ok' <> 'true' THEN RAISE EXCEPTION 'Pending refund failed: %', v; END IF;
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000007','RF-TRANSITION',2000,'INR','failed','{}'::jsonb
  );
  IF v->>'ok' <> 'true' THEN RAISE EXCEPTION 'Failed transition failed: %', v; END IF;
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000007','RF-TRANSITION',2000,'INR','success','{}'::jsonb
  );
  IF v->>'ok' <> 'true' OR v->>'refund_status' <> 'partially_refunded' THEN
    RAISE EXCEPTION 'Success transition failed: %', v;
  END IF;
  SELECT status INTO v_status FROM public.payment_refunds WHERE provider_refund_id='RF-TRANSITION';
  IF v_status <> 'success' THEN RAISE EXCEPTION 'Refund transition did not persist success'; END IF;

  -- Existing non-Cashfree India subscription remains unchanged.
  SELECT amount_paise INTO v_minor FROM public.subscriptions
   WHERE id='10000000-0000-0000-0000-000000000010';
  IF v_minor <> 20000 THEN RAISE EXCEPTION 'PhonePe subscription amount was changed'; END IF;
  SELECT status INTO v_status FROM public.subscriptions
   WHERE id='10000000-0000-0000-0000-000000000010';
  IF v_status <> 'active' THEN RAISE EXCEPTION 'PhonePe subscription status was changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.payment_refunds
              WHERE subscription_id='10000000-0000-0000-0000-000000000010') THEN
    RAISE EXCEPTION 'Non-Cashfree subscription acquired refund rows';
  END IF;

  -- Permission assertions.
  IF has_function_privilege('anon','public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated unexpectedly have RPC EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role','public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing RPC EXECUTE';
  END IF;
  IF has_table_privilege('anon','public.payment_refunds','SELECT') THEN
    RAISE EXCEPTION 'anon unexpectedly has payment_refunds SELECT';
  END IF;

  -- RLS is checked below under an actual authenticated role.
END
$$;

-- The role switch is performed outside the DO block so the subsequent query
-- executes under authenticated privileges and the real RLS policy.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.payment_refunds;
  IF v_count <> 1 THEN RAISE EXCEPTION 'RLS leaked rows or hid owner rows; visible count=%', v_count; END IF;
END
$$;
RESET ROLE;

-- service_role can execute the security-definer RPC.
SET ROLE service_role;
SELECT public.apply_cashfree_refund_event(
  '10000000-0000-0000-0000-000000000008','RF-SERVICE',1000,'INR','success','{}'::jsonb
);
RESET ROLE;

-- Verify migration replay did not duplicate ledger rows or alter PhonePe data.
SELECT count(*) AS refund_rows FROM public.payment_refunds;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.payment_refunds WHERE provider_refund_id='RF-PARTIAL') <> 1 THEN
    RAISE EXCEPTION 'Refund ledger uniqueness failed';
  END IF;
END
$$;
