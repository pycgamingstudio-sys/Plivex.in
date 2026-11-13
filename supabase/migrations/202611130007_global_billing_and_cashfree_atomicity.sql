-- Part 3: country-aware billing metadata and atomic Cashfree payment application.
-- Additive only: existing India subscription columns, rows, statuses and PayU fields remain intact.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS amount_minor_units bigint,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'month',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS provider_order_status text,
  ADD COLUMN IF NOT EXISTS provider_payment_status text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

ALTER TABLE public.payment_logs
  ADD COLUMN IF NOT EXISTS amount_minor_units bigint,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS billing_period text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.subscriptions'::regclass AND conname='subscriptions_billing_period_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_billing_period_check CHECK (billing_period IN ('month','year'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.subscriptions'::regclass AND conname='subscriptions_country_code_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_country_code_check CHECK (country_code IS NULL OR country_code IN ('IN','US','GB','AE','CA','AU','SG'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.subscriptions'::regclass AND conname='subscriptions_currency_code_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_currency_code_check CHECK (currency IN ('INR','USD','GBP','AED','CAD','AUD','SGD'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.subscriptions'::regclass AND conname='subscriptions_amount_minor_nonnegative_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_amount_minor_nonnegative_check CHECK (amount_minor_units IS NULL OR amount_minor_units >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_logs'::regclass AND conname='payment_logs_amount_minor_nonnegative_check') THEN
    ALTER TABLE public.payment_logs ADD CONSTRAINT payment_logs_amount_minor_nonnegative_check CHECK (amount_minor_units IS NULL OR amount_minor_units >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS subscriptions_workspace_currency_status_idx
  ON public.subscriptions (workspace_id, currency, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_cashfree_idempotency_key_uidx
  ON public.subscriptions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.subscriptions.amount_minor_units IS
  'Exact amount in the smallest currency unit; amount_paise remains for India legacy compatibility.';
COMMENT ON COLUMN public.subscriptions.currency IS
  'ISO 4217 transaction currency; never inferred from locale or converted without a quoted rate.';
COMMENT ON COLUMN public.subscriptions.country_code IS
  'Explicit workspace billing country snapshot at order creation.';
COMMENT ON COLUMN public.subscriptions.payment_status IS
  'Provider payment lifecycle: created, pending, success, failed, refunded, or partially_refunded.';

-- A single database transaction owns the transition from a verified Cashfree
-- order to an active subscription and its payment ledger row. The caller must
-- first verify the provider order and webhook signature with Cashfree.
CREATE OR REPLACE FUNCTION public.apply_cashfree_subscription_payment(
  p_subscription_id uuid,
  p_provider_payment_id text,
  p_currency text,
  p_amount_minor bigint,
  p_provider_order_status text,
  p_provider_payment_status text,
  p_raw jsonb DEFAULT '{}'::jsonb,
  p_source text DEFAULT 'cashfree-webhook'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_expected bigint;
  v_period text;
BEGIN
  IF p_provider_payment_id IS NULL OR length(trim(p_provider_payment_id)) = 0
     OR p_currency IS NULL OR p_amount_minor IS NULL OR p_amount_minor < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_payment_data');
  END IF;

  SELECT * INTO v_order
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'subscription_not_found');
  END IF;

  IF v_order.status::text = 'active' THEN
    RETURN jsonb_build_object('ok', true, 'already_applied', true);
  END IF;

  v_expected := COALESCE(
    v_order.amount_minor_units,
    CASE WHEN upper(v_order.currency) = 'INR' THEN v_order.amount_paise::bigint END
  );

  IF v_order.status::text <> 'created'
     OR lower(COALESCE(v_order.gateway,'')) <> 'cashfree'
     OR lower(COALESCE(v_order.provider,'')) <> 'cashfree'
     OR upper(v_order.currency) <> upper(p_currency)
     OR v_expected IS NULL OR v_expected <> p_amount_minor
     OR upper(COALESCE(p_provider_order_status,'')) <> 'PAID'
     OR upper(COALESCE(p_provider_payment_status,'')) <> 'SUCCESS'
     OR v_order.plan_id NOT IN ('basic_monthly','pro_monthly','basic_yearly','enterprise_yearly') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_not_eligible');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_logs
    WHERE provider = 'cashfree'
      AND provider_payment_id = p_provider_payment_id
      AND subscription_id IS DISTINCT FROM p_subscription_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'provider_payment_already_used');
  END IF;

  v_period := CASE
    WHEN v_order.billing_period IN ('month','year') THEN v_order.billing_period
    WHEN v_order.plan_id IN ('basic_yearly','enterprise_yearly') THEN 'year'
    ELSE 'month'
  END;

  UPDATE public.subscriptions
  SET status = 'active',
      payment_status = 'success',
      provider_payment_id = p_provider_payment_id,
      provider_order_status = upper(p_provider_order_status),
      provider_payment_status = upper(p_provider_payment_status),
      started_at = v_now,
      expires_at = CASE WHEN v_period = 'year' THEN v_now + interval '1 year' ELSE v_now + interval '1 month' END,
      updated_at = v_now
  WHERE id = p_subscription_id
    AND status::text = 'created';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'concurrent_transition');
  END IF;

  INSERT INTO public.payment_logs (
    user_id, user_email, workspace_id, txnid, subscription_id,
    provider, gateway, currency, country_code, billing_period,
    plan_id, plan_name, tier, amount, amount_minor_units,
    status, outcome, hash_verified, provider_status, gateway_status,
    provider_payment_id, raw, verified_at, reason, message, source
  ) VALUES (
    v_order.user_id, v_order.user_email, v_order.workspace_id, v_order.txnid, v_order.id,
    'cashfree', 'cashfree', upper(p_currency), v_order.country_code, v_period,
    v_order.plan_id, v_order.plan_name, v_order.tier,
    CASE WHEN p_amount_minor <= 2147483647 THEN (p_amount_minor / 100)::integer ELSE NULL END,
    p_amount_minor,
    'success', 'applied', true, upper(p_provider_payment_status), upper(p_provider_order_status),
    p_provider_payment_id, COALESCE(p_raw, '{}'::jsonb), v_now, NULL,
    'Cashfree payment verified and subscription activated', COALESCE(p_source, 'cashfree-webhook')
  );

  RETURN jsonb_build_object('ok', true, 'already_applied', false);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_cashfree_subscription_payment(uuid,text,text,bigint,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cashfree_subscription_payment(uuid,text,text,bigint,text,text,jsonb,text) TO service_role;
