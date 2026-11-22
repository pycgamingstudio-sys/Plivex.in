-- Paddle Billing support for international subscriptions.
-- Cashfree/India records and existing PayU data remain unchanged.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider_subscription_id text;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_paddle_provider_subscription_uidx
  ON public.subscriptions (provider_subscription_id)
  WHERE provider = 'paddle' AND provider_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_logs_paddle_provider_payment_uidx
  ON public.payment_logs (provider_payment_id)
  WHERE provider = 'paddle' AND provider_payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.apply_paddle_subscription_payment(
  p_subscription_id uuid,
  p_provider_payment_id text,
  p_provider_subscription_id text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_provider_order_status text,
  p_provider_payment_status text,
  p_raw jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_order public.subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_expected bigint;
  v_start timestamptz;
  v_lock_key bigint;
  v_period text;
BEGIN
  IF p_subscription_id IS NULL
     OR p_provider_payment_id IS NULL OR length(trim(p_provider_payment_id)) = 0
     OR p_provider_subscription_id IS NULL OR length(trim(p_provider_subscription_id)) = 0
     OR p_currency IS NULL OR upper(p_currency) NOT IN ('USD','GBP','AED','CAD','AUD','SGD')
     OR p_subtotal_minor IS NULL OR p_subtotal_minor <= 0
     OR p_total_minor IS NULL OR p_total_minor < p_subtotal_minor
     OR upper(COALESCE(p_provider_order_status,'')) <> 'COMPLETED'
     OR upper(COALESCE(p_provider_payment_status,'')) <> 'COMPLETED' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_payment_data');
  END IF;

  SELECT * INTO v_order
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'subscription_not_found');
  END IF;

  IF v_order.provider_payment_id = p_provider_payment_id THEN
    RETURN jsonb_build_object('ok', true, 'already_applied', true);
  END IF;

  v_expected := v_order.amount_minor_units;
  IF v_order.status::text NOT IN ('created','active')
     OR lower(COALESCE(v_order.gateway,'')) <> 'paddle'
     OR lower(COALESCE(v_order.provider,'')) <> 'paddle'
     OR upper(v_order.currency) <> upper(p_currency)
     OR v_expected IS NULL OR v_expected <> p_subtotal_minor
     OR v_order.plan_id NOT IN ('basic_monthly','pro_monthly','basic_yearly','enterprise_yearly') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_not_eligible');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_logs
    WHERE provider = 'paddle'
      AND provider_payment_id = p_provider_payment_id
      AND subscription_id IS DISTINCT FROM p_subscription_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'provider_payment_already_used');
  END IF;

  v_lock_key := pg_catalog.hashtextextended(
    COALESCE(v_order.workspace_id, 'user:' || v_order.user_id::text),
    726934822
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);
  v_now := clock_timestamp();

  v_period := CASE
    WHEN v_order.billing_period IN ('month','year') THEN v_order.billing_period
    WHEN v_order.plan_id IN ('basic_yearly','enterprise_yearly') THEN 'year'
    ELSE 'month'
  END;

  IF v_order.status::text = 'active' THEN
    v_start := greatest(COALESCE(v_order.expires_at, v_now), v_now);
  ELSIF v_order.tier::text = 'basic' THEN
    SELECT max(expires_at) INTO v_start
    FROM public.subscriptions
    WHERE workspace_id = v_order.workspace_id
      AND status::text = 'active'
      AND expires_at > v_now
      AND tier::text IN ('basic','pro');
    v_start := greatest(v_now, COALESCE(v_start, v_now));
  ELSE
    SELECT max(expires_at) INTO v_start
    FROM public.subscriptions
    WHERE workspace_id = v_order.workspace_id
      AND status::text = 'active'
      AND expires_at > v_now
      AND tier::text = 'pro';
    v_start := greatest(v_now, COALESCE(v_start, v_now));
  END IF;

  UPDATE public.subscriptions
  SET status = 'active',
      payment_status = 'success',
      provider_payment_id = p_provider_payment_id,
      provider_subscription_id = p_provider_subscription_id,
      provider_order_status = 'COMPLETED',
      provider_payment_status = 'COMPLETED',
      started_at = CASE WHEN status::text = 'created' THEN v_start ELSE started_at END,
      expires_at = CASE WHEN v_period = 'year' THEN v_start + interval '1 year' ELSE v_start + interval '1 month' END,
      updated_at = v_now
  WHERE id = p_subscription_id
    AND status::text IN ('created','active');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'concurrent_transition');
  END IF;

  INSERT INTO public.payment_logs (
    user_id, user_email, workspace_id, txnid, subscription_id,
    provider, gateway, currency, country_code, billing_period,
    plan_id, plan_name, tier, amount, amount_minor_units, amount_major, locale_code,
    status, outcome, hash_verified, provider_status, gateway_status,
    provider_payment_id, raw, verified_at, reason, message, source
  ) VALUES (
    v_order.user_id, v_order.user_email, v_order.workspace_id, p_provider_payment_id, v_order.id,
    'paddle', 'paddle', upper(p_currency), v_order.country_code, v_period,
    v_order.plan_id, v_order.plan_name, v_order.tier,
    CASE WHEN p_total_minor <= 2147483647 THEN p_total_minor::integer ELSE NULL END,
    p_total_minor, (p_total_minor::numeric / 100), v_order.locale_code,
    'success', 'applied', true, 'COMPLETED', 'COMPLETED',
    p_provider_payment_id, COALESCE(p_raw, '{}'::jsonb), v_now, NULL,
    'Paddle transaction verified and subscription activated', 'paddle-webhook'
  );

  RETURN jsonb_build_object('ok', true, 'already_applied', false);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_paddle_subscription_payment(uuid,text,text,text,bigint,bigint,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paddle_subscription_payment(uuid,text,text,text,bigint,bigint,text,text,jsonb)
  TO service_role;
