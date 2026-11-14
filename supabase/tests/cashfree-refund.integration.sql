\set ON_ERROR_STOP on

-- Disposable PostgreSQL fixture mirrors the live India payment/subscription
-- columns used by Cashfree and the existing PayU/PhonePe records.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_outcome') THEN
    CREATE TYPE public.payment_outcome AS ENUM ('applied','failed','tampered');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_tier') THEN
    CREATE TYPE public.plan_tier AS ENUM ('basic','pro','free');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE public.subscription_status AS ENUM ('created','active','failed','tampered');
  END IF;
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_email text,
  workspace_id text,
  plan_id text NOT NULL DEFAULT 'basic_monthly',
  plan_name text,
  tier public.plan_tier NOT NULL DEFAULT 'basic',
  status public.subscription_status NOT NULL DEFAULT 'created',
  amount integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  gateway text NOT NULL DEFAULT 'payu',
  payu_txnid text UNIQUE,
  payu_payment_id text,
  started_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  plan text,
  txnid text,
  amount_paise integer,
  phone text,
  return_origin text,
  return_path text,
  provider text,
  provider_payment_id text
);
CREATE UNIQUE INDEX subscriptions_txnid_unique ON public.subscriptions(txnid) WHERE txnid IS NOT NULL;

CREATE TABLE public.payment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_email text,
  workspace_id text,
  gateway text NOT NULL DEFAULT 'payu',
  txnid text,
  payu_payment_id text,
  plan_id text,
  plan_name text,
  tier text,
  amount integer,
  currency text DEFAULT 'INR',
  gateway_status text,
  outcome public.payment_outcome NOT NULL DEFAULT 'applied',
  message text,
  source text,
  hash_verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider text,
  status text,
  reason text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  provider_status text,
  provider_payment_id text
);
CREATE INDEX payment_logs_subscription_id_idx ON public.payment_logs(subscription_id);

INSERT INTO public.subscriptions
  (id,user_id,user_email,workspace_id,plan_id,plan_name,tier,status,amount,amount_paise,currency,gateway,provider,txnid)
VALUES
  ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-PARTIAL-000000000000000001'),
  ('10000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','b@example.test','ws-b','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-FULL-00000000000000000002'),
  ('10000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-REPLAY-000000000000000003'),
  ('10000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-CURRENCY-0000000000000004'),
  ('10000000-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-OVER-00000000000000000005'),
  ('10000000-0000-0000-0000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-CUMULATIVE-000000000000006'),
  ('10000000-0000-0000-0000-000000000007','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-TRANSITION-000000000000007'),
  ('10000000-0000-0000-0000-000000000008','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-SERVICE-000000000000000008'),
  ('10000000-0000-0000-0000-000000000009','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-CONCURRENT-000000000000000009'),
  ('10000000-0000-0000-0000-000000000010','cccccccc-cccc-cccc-cccc-cccccccccccc','c@example.test','ws-c','basic_monthly','Basic','basic','active',200,20000,'INR','phonepe','phonepe','PLX-PHONEPE-LEGACY-0000000000000010'),
  ('10000000-0000-0000-0000-000000000011','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-MULTI-000000000000000011'),
  ('10000000-0000-0000-0000-000000000012','dddddddd-dddd-dddd-dddd-dddddddddddd','d@example.test','ws-d','basic_monthly','Basic','basic','active',300,30000,'INR','payu','payu','PLX-PAYU-LEGACY-0000000000000012'),
  ('10000000-0000-0000-0000-000000000013','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-PER-PAYMENT-000000000013'),
  ('10000000-0000-0000-0000-000000000014','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-HIST-AMBIG-000000000014'),
  ('10000000-0000-0000-0000-000000000015','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-HIST-UNLINKED-000000000015'),
  ('10000000-0000-0000-0000-000000000016','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','e@example.test','ws-e','basic_monthly','Basic','basic','active',100,10000,'INR','cashfree','cashfree','PLXCF-HIST-PARTIAL-000000000016');

UPDATE public.subscriptions
SET payu_txnid='PAYU-TXN-12', payu_payment_id='PAYU-12'
WHERE id='10000000-0000-0000-0000-000000000012';

INSERT INTO public.payment_logs
  (id,user_id,user_email,workspace_id,gateway,txnid,plan_id,plan_name,tier,amount,currency,
   outcome,hash_verified,provider,status,subscription_id,provider_status,provider_payment_id,raw)
VALUES
  ('20000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-PARTIAL-000000000000000001','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000001','SUCCESS','700001','{"payment":{"cf_payment_id":700001}}'),
  ('20000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','b@example.test','ws-b','cashfree','PLXCF-FULL-00000000000000000002','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000002','SUCCESS','700002','{"payment":{"cf_payment_id":700002}}'),
  ('20000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-REPLAY-000000000000000003','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000003','SUCCESS','700003','{"payment":{"cf_payment_id":700003}}'),
  ('20000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-CURRENCY-0000000000000004','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000004','SUCCESS','700004','{"payment":{"cf_payment_id":700004}}'),
  ('20000000-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-OVER-00000000000000000005','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000005','SUCCESS','700005','{"payment":{"cf_payment_id":700005}}'),
  ('20000000-0000-0000-0000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-CUMULATIVE-000000000000006','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000006','SUCCESS','700006','{"payment":{"cf_payment_id":700006}}'),
  ('20000000-0000-0000-0000-000000000007','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-TRANSITION-000000000000007','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000007','SUCCESS','700007','{"payment":{"cf_payment_id":700007}}'),
  ('20000000-0000-0000-0000-000000000008','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-SERVICE-000000000000000008','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000008','SUCCESS','700008','{"payment":{"cf_payment_id":700008}}'),
  ('20000000-0000-0000-0000-000000000009','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-CONCURRENT-000000000000000009','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000009','SUCCESS','700009','{"payment":{"cf_payment_id":700009}}'),
  ('20000000-0000-0000-0000-000000000010','cccccccc-cccc-cccc-cccc-cccccccccccc','c@example.test','ws-c','phonepe','PLX-PHONEPE-LEGACY-0000000000000010','basic_monthly','Basic','basic',20000,'INR','applied',true,'phonepe','success','10000000-0000-0000-0000-000000000010','COMPLETED','PP-10010','{}'),
  ('20000000-0000-0000-0000-000000000011','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-MULTI-000000000000000011','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000011','SUCCESS','711001','{"payment":{"cf_payment_id":711001}}'),
  ('20000000-0000-0000-0000-000000000012','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-MULTI-000000000000000011','basic_monthly','Basic','basic',10000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000011','SUCCESS','711002','{"payment":{"cf_payment_id":711002}}'),
  ('20000000-0000-0000-0000-000000000013','dddddddd-dddd-dddd-dddd-dddddddddddd','d@example.test','ws-d','payu','PLX-PAYU-LEGACY-0000000000000012','basic_monthly','Basic','basic',30000,'INR','applied',true,'payu','success','10000000-0000-0000-0000-000000000012','SUCCESS','PAYU-12','{}'),
  ('20000000-0000-0000-0000-000000000014','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test','ws-a','cashfree','PLXCF-PER-PAYMENT-000000000013','basic_monthly','Basic','basic',5000,'INR','applied',true,'cashfree','success','10000000-0000-0000-0000-000000000013','SUCCESS','713001','{"payment":{"cf_payment_id":713001}}');

UPDATE public.payment_logs
SET payu_payment_id='PAYU-12'
WHERE id='20000000-0000-0000-0000-000000000013';

-- Apply both real migrations, then replay the targeted additive migration.
\ir ../migrations/20261114000000_india_cashfree_refund_support.sql

-- Historical refund fixtures are seeded before the linkage migration so its
-- audited reconciliation path sees realistic pre-existing NULL links.
INSERT INTO public.payment_refunds
  (id,subscription_id,payment_log_id,user_id,workspace_id,provider,provider_refund_id,
   amount_minor_units,currency,status,raw)
VALUES
  ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000015',NULL,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','cashfree','RF-HIST-UNLINKED-2K',2000,'INR','success',
   '{"data":{"refund":{"order_id":"PLXCF-HIST-UNLINKED-000000000015","cf_payment_id":799015}}}'),
  ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003',NULL,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','cashfree','RF-HIST-VERIFIED',1500,'INR','success',
   '{"data":{"refund":{"order_id":"PLXCF-REPLAY-000000000000000003","cf_payment_id":700003}}}'),
  ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000014',NULL,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','cashfree','RF-HIST-AMBIGUOUS',500,'INR','success',
   '{"data":{"refund":{"order_id":"PLXCF-HIST-AMBIG-000000000014","cf_payment_id":714001}}}'),
  ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000015',NULL,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ws-a','cashfree','RF-HIST-SERVICE-RECON',1000,'INR','success',
   '{"data":{"refund":{"order_id":"PLXCF-HIST-UNLINKED-000000000015","cf_payment_id":715002}}}');

-- Historical provider/gateway mismatches and NULL provider are not Cashfree
-- ledger rows and must never be cleared/rebuilt by Cashfree cleanup.
INSERT INTO public.payment_logs
  (id,workspace_id,gateway,txnid,amount,currency,outcome,provider,subscription_id,
   provider_payment_id,refund_status,refund_amount_minor_units)
VALUES
  ('20000000-0000-0000-0000-000000000015','ws-a','payu','LEGACY-PROVIDER-CASHFREE-GATEWAY',10000,'INR','applied','cashfree',NULL,'MISMATCH-1','legacy_provider_mismatch',2222),
  ('20000000-0000-0000-0000-000000000016','ws-a','cashfree','LEGACY-GATEWAY-CASHFREE-PROVIDER',10000,'INR','applied','payu',NULL,'MISMATCH-2','legacy_gateway_mismatch',3333),
  ('20000000-0000-0000-0000-000000000017','ws-a','cashfree','LEGACY-NULL-PROVIDER',10000,'INR','applied',NULL,NULL,'NULL-PROVIDER','legacy_null_provider',4444),
  ('20000000-0000-0000-0000-000000000025','ws-a','cashfree','LEGACY-CASHFREE-NO-LEDGER',10000,'INR','applied','cashfree',NULL,'NO-LEDGER','legacy_unreconstructable',5555),
  ('20000000-0000-0000-0000-000000000021','ws-a','cashfree','PLXCF-HIST-UNLINKED-000000000015',10000,'INR','applied','cashfree',
   '10000000-0000-0000-0000-000000000015','715001',NULL,NULL),
  ('20000000-0000-0000-0000-000000000022','ws-a','cashfree','PLXCF-HIST-AMBIG-000000000014',10000,'INR','applied','cashfree',
   '10000000-0000-0000-0000-000000000014','714001',NULL,NULL),
  ('20000000-0000-0000-0000-000000000023','ws-a','cashfree','PLXCF-HIST-AMBIG-000000000014',10000,'INR','applied','cashfree',
   '10000000-0000-0000-0000-000000000014','714001',NULL,NULL),
  ('20000000-0000-0000-0000-000000000098','ws-a','cashfree','PLXCF-HIST-AMBIG-000000000014',10000,'INR','applied','cashfree',
   '10000000-0000-0000-0000-000000000014','714001',NULL,NULL);

-- The real schema declares payment_logs.gateway NOT NULL; prove the NULL
-- gateway fixture is rejected rather than weakening the production-shaped test schema.
DO $test_block$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.payment_logs (id,gateway,provider,txnid)
    VALUES ('20000000-0000-0000-0000-000000000097',NULL,'cashfree','NULL-GATEWAY-UNSUPPORTED');
  EXCEPTION WHEN not_null_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Expected payment_logs.gateway NOT NULL constraint'; END IF;
END
$test_block$;

INSERT INTO public.payment_logs
  (id,user_id,user_email,workspace_id,gateway,txnid,plan_id,plan_name,tier,amount,currency,
   outcome,hash_verified,provider,status,subscription_id,provider_status,provider_payment_id,
   refund_status,refund_amount_minor_units,raw)
VALUES
  ('20000000-0000-0000-0000-000000000026','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','e@example.test','ws-e',
   'cashfree','PLXCF-HIST-PARTIAL-000000000016','basic_monthly','Basic','basic',10000,'INR',
   'applied',true,'cashfree','success','10000000-0000-0000-0000-000000000016','SUCCESS','716001',
   'partially_refunded',5000,'{"payment":{"cf_payment_id":716001}}');
INSERT INTO public.payment_refunds
  (id,subscription_id,payment_log_id,user_id,workspace_id,provider,provider_refund_id,
   amount_minor_units,currency,status,raw)
VALUES
  ('30000000-0000-0000-0000-000000000016','10000000-0000-0000-0000-000000000016',
   '20000000-0000-0000-0000-000000000026','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','ws-e',
   'cashfree','RF-HIST-PARTIAL-2K',2000,'INR','success',
   '{"data":{"refund":{"order_id":"PLXCF-HIST-PARTIAL-000000000016","cf_payment_id":716001}}}');

\ir ../migrations/20261114000001_cashfree_refund_payment_log_linkage.sql
\ir ../migrations/20261114000001_cashfree_refund_payment_log_linkage.sql

-- The historical ₹5,000 total is not complete/reconstructable from a ₹2,000
-- linked successful ledger. Both migration apply and replay must preserve it.
DO $historical_partial_ledger$
DECLARE v_total bigint; v_status text; v_sub_status text; v_sub_payment_status text; v_sub_refund_status text;
BEGIN
  SELECT refund_amount_minor_units, refund_status INTO v_total, v_status
  FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000026';
  SELECT status::text, payment_status, refund_status INTO v_sub_status, v_sub_payment_status, v_sub_refund_status
  FROM public.subscriptions WHERE id='10000000-0000-0000-0000-000000000016';
  IF v_total <> 5000 OR v_status <> 'reconciliation_required' THEN
    RAISE EXCEPTION 'Incomplete historical ledger overwrote/failed to hold ₹5,000 total: %, %',v_total,v_status;
  END IF;
  IF v_sub_status <> 'active' OR v_sub_payment_status IS DISTINCT FROM 'success' OR v_sub_refund_status IS NOT NULL THEN
    RAISE EXCEPTION 'Incomplete historical ledger changed subscription accounting state: %, %, %',v_sub_status,v_sub_payment_status,v_sub_refund_status;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cashfree_refund_cleanup_exceptions
    WHERE payment_log_id='20000000-0000-0000-0000-000000000026'
      AND reason='cashfree_ledger_incomplete'
      AND prior_refund_amount_minor_units=5000
  ) THEN RAISE EXCEPTION 'Incomplete ₹5,000/₹2,000 ledger exception was not recorded'; END IF;
END
$historical_partial_ledger$;



DO $$
DECLARE
  v jsonb;
  v_count integer;
  v_minor bigint;
  v_status text;
  v_payment_log_id uuid;
  v_blocked boolean;
  v_field text;
BEGIN
  -- One subscription / one payment log: partial refund links to the exact log.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000001','RF-PARTIAL',3000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-PARTIAL-000000000000000001","cf_payment_id":700001}}}'::jsonb
  );
  SELECT payment_log_id INTO v_payment_log_id FROM public.payment_refunds WHERE provider_refund_id='RF-PARTIAL';
  IF v->>'ok' <> 'true' OR (v->>'payment_refunded_minor_units')::bigint <> 3000
     OR v_payment_log_id <> '20000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'Partial refund did not link to the exact payment log: %', v;
  END IF;

  -- One subscription / one payment log: full refund.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000002','RF-FULL',10000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-FULL-00000000000000000002","cf_payment_id":700002}}}'::jsonb
  );
  IF v->>'ok' <> 'true' OR v->>'fully_refunded' <> 'true' THEN
    RAISE EXCEPTION 'Full refund failed: %', v;
  END IF;
  SELECT status::text INTO v_status FROM public.subscriptions
   WHERE id='10000000-0000-0000-0000-000000000002';
  IF v_status <> 'failed' THEN RAISE EXCEPTION 'Full refund did not close subscription'; END IF;

  -- Same refund ID replay is idempotent.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000001','RF-PARTIAL',3000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-PARTIAL-000000000000000001","cf_payment_id":700001}}}'::jsonb
  );
  IF v->>'ok' <> 'true' OR v->>'already_applied' <> 'true' THEN
    RAISE EXCEPTION 'Refund replay was not idempotent: %', v;
  END IF;

  -- Same refund ID with changed amount is rejected.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000001','RF-PARTIAL',3100,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-PARTIAL-000000000000000001","cf_payment_id":700001}}}'::jsonb
  );
  IF v->>'reason' <> 'refund_amount_conflict' THEN
    RAISE EXCEPTION 'Changed refund amount was not rejected: %', v;
  END IF;

  -- Cross-subscription refund ID reuse is rejected.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000003','RF-PARTIAL',3000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-REPLAY-000000000000000003","cf_payment_id":700003}}}'::jsonb
  );
  IF v->>'reason' <> 'refund_id_already_used' THEN
    RAISE EXCEPTION 'Cross-subscription duplicate refund ID was not rejected: %', v;
  END IF;

  -- Currency mismatch.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000004','RF-CURRENCY',1000,'USD','success',
    '{"data":{"refund":{"order_id":"PLXCF-CURRENCY-0000000000000004","cf_payment_id":700004}}}'::jsonb
  );
  IF v->>'reason' <> 'refund_order_mismatch' THEN
    RAISE EXCEPTION 'Currency mismatch was not rejected: %', v;
  END IF;

  -- A single refund cannot exceed the original payment log.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000005','RF-OVER',10001,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-OVER-00000000000000000005","cf_payment_id":700005}}}'::jsonb
  );
  IF v->>'reason' <> 'refund_amount_invalid' THEN
    RAISE EXCEPTION 'Single over-refund was not rejected: %', v;
  END IF;

  -- Multiple attempts on one subscription: distinct cf_payment_id values link to distinct logs.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000011','RF-MULTI-A1',1000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-MULTI-000000000000000011","cf_payment_id":711001}}}'::jsonb
  );
  IF v->>'ok' <> 'true' THEN RAISE EXCEPTION 'First refund on attempt A failed: %', v; END IF;
  -- Replaying the same refund identity against another payment log is rejected.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000011','RF-MULTI-A1',1000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-MULTI-000000000000000011","cf_payment_id":711002}}}'::jsonb
  );
  IF v->>'reason' <> 'refund_payment_mapping_conflict' THEN
    RAISE EXCEPTION 'Refund ID was allowed to move to another payment log: %', v;
  END IF;

  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000011','RF-MULTI-A2',2000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-MULTI-000000000000000011","cf_payment_id":711001}}}'::jsonb
  );
  IF v->>'ok' <> 'true' THEN RAISE EXCEPTION 'Second refund on attempt A failed: %', v; END IF;
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000011','RF-MULTI-B1',4000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-MULTI-000000000000000011","cf_payment_id":711002}}}'::jsonb
  );
  IF v->>'ok' <> 'true' OR (v->>'refunded_minor_units')::bigint <> 7000 THEN
    RAISE EXCEPTION 'Refund across different payment logs failed: %', v;
  END IF;

  IF (SELECT refund_amount_minor_units FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000011') <> 3000
     OR (SELECT refund_amount_minor_units FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000012') <> 4000 THEN
    RAISE EXCEPTION 'Per-payment refund totals were not isolated';
  END IF;
  IF (SELECT refund_amount_minor_units FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000001') <> 3000 THEN
    RAISE EXCEPTION 'Unrelated payment log was modified';
  END IF;

  -- Provider/gateway mismatches must not satisfy the exact Cashfree mapping.
  INSERT INTO public.payment_logs
    (id,workspace_id,gateway,txnid,amount,currency,outcome,provider,subscription_id,provider_payment_id)
  VALUES
    ('20000000-0000-0000-0000-000000000096','ws-a','payu',
     'PLXCF-MULTI-000000000000000011',10000,'INR','applied','cashfree',
     '10000000-0000-0000-0000-000000000011','799991');
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000011','RF-WRONG-GATEWAY',100,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-MULTI-000000000000000011","cf_payment_id":799991}}}'::jsonb
  );
  IF v->>'reason' <> 'payment_mapping_not_found' THEN
    RAISE EXCEPTION 'Gateway-mismatched payment log incorrectly satisfied Cashfree mapping: %', v;
  END IF;
  DELETE FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000096';

  -- A refund with a non-existent cf_payment_id is rejected, not guessed by order ID.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000011','RF-UNKNOWN',100,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-MULTI-000000000000000011","cf_payment_id":799999}}}'::jsonb
  );
  IF v->>'reason' <> 'payment_mapping_not_found' THEN
    RAISE EXCEPTION 'Unknown payment mapping was not rejected: %', v;
  END IF;

  -- Duplicate provider payment IDs are ambiguous and must be rejected.
  INSERT INTO public.payment_logs
    (id,workspace_id,gateway,txnid,amount,currency,outcome,provider,subscription_id,provider_payment_id)
  VALUES
    ('20000000-0000-0000-0000-000000000099','ws-a','cashfree',
     'PLXCF-MULTI-000000000000000011',10000,'INR','applied','cashfree',
     '10000000-0000-0000-0000-000000000011','711001');
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000011','RF-AMBIGUOUS',100,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-MULTI-000000000000000011","cf_payment_id":711001}}}'::jsonb
  );
  IF v->>'reason' <> 'payment_mapping_ambiguous' THEN
    RAISE EXCEPTION 'Ambiguous payment mapping was not rejected: %', v;
  END IF;
  DELETE FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000099';

  -- Payment-log identity is immutable after refund insertion.
  v_blocked := false;
  BEGIN
    UPDATE public.payment_refunds
    SET payment_log_id='20000000-0000-0000-0000-000000000012'
    WHERE provider_refund_id='RF-MULTI-A1';
  EXCEPTION WHEN raise_exception THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Refund payment_log_id identity was mutable'; END IF;

  -- Every other refund identity field is immutable as well.
  FOR v_field IN SELECT unnest(ARRAY[
    'subscription_id','user_id','workspace_id','provider','provider_refund_id',
    'amount_minor_units','currency'
  ]) LOOP
    v_blocked := false;
    BEGIN
      CASE v_field
        WHEN 'subscription_id' THEN
          UPDATE public.payment_refunds SET subscription_id='10000000-0000-0000-0000-000000000001'
          WHERE provider_refund_id='RF-MULTI-A1';
        WHEN 'user_id' THEN
          UPDATE public.payment_refunds SET user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
          WHERE provider_refund_id='RF-MULTI-A1';
        WHEN 'workspace_id' THEN
          UPDATE public.payment_refunds SET workspace_id='ws-other'
          WHERE provider_refund_id='RF-MULTI-A1';
        WHEN 'provider' THEN
          UPDATE public.payment_refunds SET provider='payu'
          WHERE provider_refund_id='RF-MULTI-A1';
        WHEN 'provider_refund_id' THEN
          UPDATE public.payment_refunds SET provider_refund_id='RF-IDENTITY-CHANGED'
          WHERE provider_refund_id='RF-MULTI-A1';
        WHEN 'amount_minor_units' THEN
          UPDATE public.payment_refunds SET amount_minor_units=999
          WHERE provider_refund_id='RF-MULTI-A1';
        WHEN 'currency' THEN
          UPDATE public.payment_refunds SET currency='USD'
          WHERE provider_refund_id='RF-MULTI-A1';
      END CASE;
    EXCEPTION WHEN raise_exception THEN
      v_blocked := true;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'Refund identity field % was mutable', v_field;
    END IF;
  END LOOP;

  -- Cashfree payment-log identity fields cannot be rewritten after payment capture.
  v_blocked := false;
  BEGIN
    UPDATE public.payment_logs
    SET provider_payment_id='799001', amount=9999, currency='USD',
        subscription_id='10000000-0000-0000-0000-000000000012'
    WHERE id='20000000-0000-0000-0000-000000000011';
  EXCEPTION WHEN raise_exception THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Cashfree provider_payment_id identity was mutable'; END IF;

  -- Per-payment cumulative boundary: payment log amount is 5,000 while subscription is 10,000.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000013','RF-PER-PAYMENT-1',3000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-PER-PAYMENT-000000000013","cf_payment_id":713001}}}'::jsonb
  );
  IF v->>'ok' <> 'true' THEN RAISE EXCEPTION 'First per-payment refund failed: %', v; END IF;
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000013','RF-PER-PAYMENT-2',2501,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-PER-PAYMENT-000000000013","cf_payment_id":713001}}}'::jsonb
  );
  IF v->>'reason' <> 'cumulative_refund_exceeds_payment_log' THEN
    RAISE EXCEPTION 'Per-payment cumulative limit was not enforced: %', v;
  END IF;

  -- Subscription aggregate boundary across two different payment logs.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000011','RF-MULTI-B2',3000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-MULTI-000000000000000011","cf_payment_id":711002}}}'::jsonb
  );
  IF v->>'ok' <> 'true' OR (v->>'refunded_minor_units')::bigint <> 10000 THEN
    RAISE EXCEPTION 'Subscription aggregate did not reach the original order amount: %', v;
  END IF;
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000011','RF-MULTI-A3',1,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-MULTI-000000000000000011","cf_payment_id":711001}}}'::jsonb
  );
  IF v->>'reason' <> 'cumulative_refund_exceeds_payment' THEN
    RAISE EXCEPTION 'Subscription cumulative boundary across logs was not enforced: %', v;
  END IF;
  IF (SELECT refund_amount_minor_units FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000011') <> 3000
     OR (SELECT refund_amount_minor_units FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000012') <> 7000 THEN
    RAISE EXCEPTION 'Per-payment totals changed after rejected subscription aggregate refund';
  END IF;

  -- Pending -> failed -> success transition remains supported and mapped to the same payment log.
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000007','RF-TRANSITION',2000,'INR','pending',
    '{"data":{"refund":{"order_id":"PLXCF-TRANSITION-000000000000007","cf_payment_id":700007}}}'::jsonb
  );
  IF v->>'ok' <> 'true' THEN RAISE EXCEPTION 'Pending refund failed: %', v; END IF;
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000007','RF-TRANSITION',2000,'INR','failed',
    '{"data":{"refund":{"order_id":"PLXCF-TRANSITION-000000000000007","cf_payment_id":700007}}}'::jsonb
  );
  IF v->>'ok' <> 'true' THEN RAISE EXCEPTION 'Failed transition failed: %', v; END IF;
  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000007','RF-TRANSITION',2000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-TRANSITION-000000000000007","cf_payment_id":700007}}}'::jsonb
  );
  IF v->>'ok' <> 'true' OR v->>'refund_status' <> 'partially_refunded' THEN
    RAISE EXCEPTION 'Success transition failed: %', v;
  END IF;
  SELECT status INTO v_status FROM public.payment_refunds WHERE provider_refund_id='RF-TRANSITION';
  IF v_status <> 'success' THEN RAISE EXCEPTION 'Refund transition did not persist success'; END IF;

  -- PhonePe and PayU rows are unchanged by Cashfree refund updates.
  IF EXISTS (
    SELECT 1 FROM public.payment_logs
    WHERE ((provider = 'phonepe' AND id='20000000-0000-0000-0000-000000000010')
        OR (provider = 'payu' AND id='20000000-0000-0000-0000-000000000013'))
      AND (refund_status IS NOT NULL OR refund_amount_minor_units IS NOT NULL)
  ) THEN RAISE EXCEPTION 'PhonePe/PayU baseline payment logs were modified'; END IF;
  SELECT amount_paise INTO v_minor FROM public.subscriptions
   WHERE id='10000000-0000-0000-0000-000000000010';
  IF v_minor <> 20000 THEN RAISE EXCEPTION 'PhonePe subscription amount was changed'; END IF;
  SELECT status INTO v_status FROM public.subscriptions
   WHERE id='10000000-0000-0000-0000-000000000010';
  IF v_status <> 'active' THEN RAISE EXCEPTION 'PhonePe subscription status was changed'; END IF;
  SELECT amount_paise INTO v_minor FROM public.subscriptions
   WHERE id='10000000-0000-0000-0000-000000000012';
  IF v_minor <> 30000 THEN RAISE EXCEPTION 'PayU subscription amount was changed'; END IF;
  IF (SELECT payu_payment_id FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000013') <> 'PAYU-12' THEN
    RAISE EXCEPTION 'PayU payment-log identifier was changed';
  END IF;

  -- Permissions: only service_role may execute the RPC; anon cannot read the refund ledger.
  IF has_function_privilege('anon','public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated unexpectedly have RPC EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role','public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing RPC EXECUTE';
  END IF;
  IF has_function_privilege('anon','public.reconcile_cashfree_refund_payment_log(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.reconcile_cashfree_refund_payment_log(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated unexpectedly have historical reconciliation EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role','public.reconcile_cashfree_refund_payment_log(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing historical reconciliation EXECUTE';
  END IF;
  IF has_table_privilege('service_role','public.cashfree_refund_reconciliation_audit','SELECT') THEN
    RAISE EXCEPTION 'service_role unexpectedly has direct audit-table SELECT';
  END IF;
  IF has_table_privilege('anon','public.payment_refunds','SELECT') THEN
    RAISE EXCEPTION 'anon unexpectedly has payment_refunds SELECT';
  END IF;
END
$$;

-- Historical unlinked ₹2,000 refund blocks a new ₹10,000 refund against
-- the ₹10,000 original. The rejected webhook must not mutate any ledger or
-- accounting state.
DO $test_block$
DECLARE
  v jsonb;
  v_count integer;
  v_status text;
  v_payment_status text;
  v_refund_status text;
  v_log_status text;
  v_log_total bigint;
  v_old_amount bigint;
  v_old_status text;
BEGIN
  SELECT amount_minor_units,status INTO v_old_amount,v_old_status
  FROM public.payment_refunds WHERE id='30000000-0000-0000-0000-000000000001';
  SELECT status::text,payment_status,refund_status INTO v_status,v_payment_status,v_refund_status
  FROM public.subscriptions WHERE id='10000000-0000-0000-0000-000000000015';
  SELECT refund_status,refund_amount_minor_units INTO v_log_status,v_log_total
  FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000021';
  SELECT count(*) INTO v_count FROM public.payment_refunds WHERE subscription_id='10000000-0000-0000-0000-000000000015';

  v := public.apply_cashfree_refund_event(
    '10000000-0000-0000-0000-000000000015','RF-HIST-NEW-10K',10000,'INR','success',
    '{"data":{"refund":{"order_id":"PLXCF-HIST-UNLINKED-000000000015","cf_payment_id":715001}}}'::jsonb
  );
  IF v->>'reason' <> 'historical_refund_reconciliation_required' THEN
    RAISE EXCEPTION 'Historical unlinked refund did not block new refund: %', v;
  END IF;
  IF (SELECT count(*) FROM public.payment_refunds WHERE subscription_id='10000000-0000-0000-0000-000000000015') <> v_count
     OR (SELECT amount_minor_units FROM public.payment_refunds WHERE id='30000000-0000-0000-0000-000000000001') <> v_old_amount
     OR (SELECT status FROM public.payment_refunds WHERE id='30000000-0000-0000-0000-000000000001') <> v_old_status THEN
    RAISE EXCEPTION 'Rejected historical-conflict refund changed refund ledger rows';
  END IF;
  IF (SELECT status::text FROM public.subscriptions WHERE id='10000000-0000-0000-0000-000000000015') <> v_status
     OR (SELECT payment_status FROM public.subscriptions WHERE id='10000000-0000-0000-0000-000000000015') IS DISTINCT FROM v_payment_status
     OR (SELECT refund_status FROM public.subscriptions WHERE id='10000000-0000-0000-0000-000000000015') IS DISTINCT FROM v_refund_status THEN
    RAISE EXCEPTION 'Rejected historical-conflict refund changed subscription accounting state';
  END IF;
  IF (SELECT refund_status FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000021') IS DISTINCT FROM v_log_status
     OR (SELECT refund_amount_minor_units FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000021') IS DISTINCT FROM v_log_total THEN
    RAISE EXCEPTION 'Rejected historical-conflict refund changed payment-log totals/status';
  END IF;
END
$test_block$;

-- Once a mapping becomes deterministic, service_role alone can invoke the
-- audited reconciliation function. The unrelated unresolved ₹2,000 row keeps
-- the subscription-wide reconciliation hold in place.
INSERT INTO public.payment_logs
  (id,workspace_id,gateway,txnid,amount,currency,outcome,provider,subscription_id,provider_payment_id)
VALUES
  ('20000000-0000-0000-0000-000000000024','ws-a','cashfree',
   'PLXCF-HIST-UNLINKED-000000000015',10000,'INR','applied','cashfree',
   '10000000-0000-0000-0000-000000000015','715002');
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $service_reconcile$
DECLARE v jsonb;
BEGIN
  v := public.reconcile_cashfree_refund_payment_log('30000000-0000-0000-0000-000000000004');
  IF v->>'ok' <> 'true' OR v->>'reconciled' <> 'true' THEN
    RAISE EXCEPTION 'service_role verified historical reconciliation failed: %', v;
  END IF;
END
$service_reconcile$;
RESET ROLE;
DO $service_reconcile_check$
BEGIN
  IF (SELECT payment_log_id FROM public.payment_refunds
      WHERE id='30000000-0000-0000-0000-000000000004')
     <> '20000000-0000-0000-0000-000000000024'::uuid THEN
    RAISE EXCEPTION 'service_role reconciliation did not persist exact link';
  END IF;
  IF (SELECT refund_status FROM public.payment_logs
      WHERE id='20000000-0000-0000-0000-000000000021') <> 'reconciliation_required'
     OR (SELECT refund_status FROM public.payment_logs
         WHERE id='20000000-0000-0000-0000-000000000024') <> 'reconciliation_required' THEN
    RAISE EXCEPTION 'Reconciliation hold cleared or was not propagated while another historical refund remained unlinked';
  END IF;
  IF (SELECT reconciled_by FROM public.cashfree_refund_reconciliation_audit
      WHERE refund_id='30000000-0000-0000-0000-000000000004') <> 'service_role' THEN
    RAISE EXCEPTION 'Historical reconciliation audit did not capture service_role caller';
  END IF;
END
$service_reconcile_check$;

-- Verified NULL -> exact payment-log reconciliation is audited; ambiguous
-- historical mapping remains NULL and flagged for manual review.
DO $test_block$
DECLARE
  v_link uuid;
  v_count integer;
  v jsonb;
  v_blocked boolean;
BEGIN
  SELECT payment_log_id INTO v_link FROM public.payment_refunds
  WHERE id='30000000-0000-0000-0000-000000000002';
  IF v_link <> '20000000-0000-0000-0000-000000000003'::uuid THEN
    RAISE EXCEPTION 'Verified historical refund was not linked to exact payment log';
  END IF;
  SELECT count(*) INTO v_count FROM public.cashfree_refund_reconciliation_audit
  WHERE refund_id='30000000-0000-0000-0000-000000000002'
    AND payment_log_id='20000000-0000-0000-0000-000000000003'
    AND action='verified_null_to_link';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Verified historical reconciliation was not audited exactly once'; END IF;

  IF (SELECT payment_log_id FROM public.payment_refunds
      WHERE id='30000000-0000-0000-0000-000000000003') IS NOT NULL THEN
    RAISE EXCEPTION 'Ambiguous historical refund was incorrectly linked';
  END IF;

  v := public.reconcile_cashfree_refund_payment_log('30000000-0000-0000-0000-000000000003');
  IF v->>'reason' <> 'historical_refund_mapping_ambiguous' THEN
    RAISE EXCEPTION 'Ambiguous historical reconciliation was not rejected: %', v;
  END IF;

  -- A direct NULL -> non-NULL update is not a general-purpose bypass.
  v_blocked := false;
  BEGIN
    UPDATE public.payment_refunds
    SET payment_log_id='20000000-0000-0000-0000-000000000022'
    WHERE id='30000000-0000-0000-0000-000000000003';
  EXCEPTION WHEN raise_exception THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Direct NULL-to-linked identity update bypassed reconciliation'; END IF;
  IF (SELECT refund_status FROM public.payment_logs
      WHERE id='20000000-0000-0000-0000-000000000022') <> 'reconciliation_required' THEN
    RAISE EXCEPTION 'Ambiguous historical refund did not retain reconciliation marker';
  END IF;

  IF (SELECT refund_status FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000015') <> 'legacy_provider_mismatch'
     OR (SELECT refund_amount_minor_units FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000015') <> 2222
     OR (SELECT refund_status FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000016') <> 'legacy_gateway_mismatch'
     OR (SELECT refund_amount_minor_units FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000016') <> 3333
     OR (SELECT refund_status FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000017') <> 'legacy_null_provider'
     OR (SELECT refund_amount_minor_units FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000017') <> 4444
     OR (SELECT refund_status FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000025') <> 'legacy_unreconstructable'
     OR (SELECT refund_amount_minor_units FROM public.payment_logs WHERE id='20000000-0000-0000-0000-000000000025') <> 5555 THEN
    RAISE EXCEPTION 'Cashfree cleanup changed mismatched, NULL-provider, or unreconstructable payment-log values';
  END IF;
  IF (SELECT count(*) FROM public.cashfree_refund_cleanup_exceptions
      WHERE payment_log_id IN ('20000000-0000-0000-0000-000000000015',
                               '20000000-0000-0000-0000-000000000016',
                               '20000000-0000-0000-0000-000000000017')
        AND reason='provider_gateway_mismatch') <> 3
     OR (SELECT reason FROM public.cashfree_refund_cleanup_exceptions
         WHERE payment_log_id='20000000-0000-0000-0000-000000000025') <> 'cashfree_ledger_missing' THEN
    RAISE EXCEPTION 'Provider/gateway mismatches or unreconstructable Cashfree totals were not audited';
  END IF;
END
$test_block$;

-- RLS must expose only the authenticated user's own refund rows.
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
  '10000000-0000-0000-0000-000000000008','RF-SERVICE',1000,'INR','success',
  '{"data":{"refund":{"order_id":"PLXCF-SERVICE-000000000000000008","cf_payment_id":700008}}}'::jsonb
);
RESET ROLE;

-- Prepare a historically ambiguous refund for a deterministic lock-order race.
-- The two duplicate payment attempts are removed only after all ambiguity assertions.
DELETE FROM public.payment_logs
WHERE id IN ('20000000-0000-0000-0000-000000000023',
             '20000000-0000-0000-0000-000000000098');

DO $prepare_reconcile_webhook_race$
BEGIN
  IF (SELECT count(*) FROM public.payment_logs
      WHERE subscription_id='10000000-0000-0000-0000-000000000014'
        AND provider='cashfree' AND gateway='cashfree'
        AND provider_payment_id='714001') <> 1 THEN
    RAISE EXCEPTION 'Concurrency fixture does not have exactly one verified payment match';
  END IF;
  IF (SELECT payment_log_id FROM public.payment_refunds
      WHERE id='30000000-0000-0000-0000-000000000003') IS NOT NULL THEN
    RAISE EXCEPTION 'Concurrency fixture must begin with an unlinked historical refund';
  END IF;
END
$prepare_reconcile_webhook_race$;

-- Migration replay did not duplicate refund rows; Cashfree mapping remains unique.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.payment_refunds WHERE provider_refund_id='RF-PARTIAL') <> 1 THEN
    RAISE EXCEPTION 'Refund ledger uniqueness failed';
  END IF;
  IF (SELECT payment_log_id FROM public.payment_refunds WHERE provider_refund_id='RF-PARTIAL')
     <> '20000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Payment-log linkage changed on migration replay';
  END IF;
END
$$;
