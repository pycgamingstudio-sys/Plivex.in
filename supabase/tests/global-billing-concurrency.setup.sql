-- Disposable PostgreSQL fixture for true multi-session renewal race testing.
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $fn$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
CREATE TYPE public.subscription_status AS ENUM ('created','active','failed','tampered');
CREATE TYPE public.subscription_tier AS ENUM ('free','basic','pro');
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
 outcome text NOT NULL,
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
\ir ../migrations/202611130009_global_billing_concurrency_and_definer_hardening.sql

INSERT INTO public.subscriptions (
 user_id,user_email,workspace_id,plan_id,plan_name,tier,status,amount,amount_minor_units,amount_major,
 currency,country_code,locale_code,billing_period,gateway,provider,txnid,started_at,expires_at
) VALUES
 ('11111111-1111-1111-1111-111111111111','owner@example.test','ws-parallel','basic_monthly','Basic Monthly','basic','active',6,599,5.99,
  'USD','US','en-US','month','cashfree','cashfree','PRIOR-ACTIVE',now()-interval '1 day',now()+interval '5 days'),
 ('11111111-1111-1111-1111-111111111111','owner@example.test','ws-parallel','basic_monthly','Basic Monthly','basic','created',6,599,5.99,
  'USD','US','en-US','month','cashfree','cashfree','ORDER-PARALLEL-1',NULL,NULL),
 ('11111111-1111-1111-1111-111111111111','owner@example.test','ws-parallel','basic_monthly','Basic Monthly','basic','created',6,599,5.99,
  'USD','US','en-US','month','cashfree','cashfree','ORDER-PARALLEL-2',NULL,NULL);
