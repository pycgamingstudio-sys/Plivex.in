-- Part 3 remediation: serialize workspace subscription activations and harden
-- SECURITY DEFINER routines against search_path object shadowing.
-- Additive migration; existing India PayU rows and payment flow are untouched.

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
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_order public.subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_expected bigint;
  v_period text;
  v_start timestamptz;
  v_lock_key bigint;
BEGIN
  IF p_subscription_id IS NULL
     OR p_provider_payment_id IS NULL OR length(trim(p_provider_payment_id)) = 0
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
    IF v_order.provider_payment_id = p_provider_payment_id THEN
      RETURN jsonb_build_object('ok', true, 'already_applied', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'subscription_already_paid');
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

  -- Serialize all paid subscription transitions for one workspace. Locking
  -- the order row alone is insufficient because concurrent orders have
  -- different subscription IDs and can otherwise read the same old expiry.
  v_lock_key := pg_catalog.hashtextextended(
    COALESCE(v_order.workspace_id, 'user:' || v_order.user_id::text),
    726934821
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);
  -- Refresh the clock after any lock wait so an expiring period is not
  -- extended from a stale pre-wait timestamp.
  v_now := clock_timestamp();

  v_period := CASE
    WHEN v_order.billing_period IN ('month','year') THEN v_order.billing_period
    WHEN v_order.plan_id IN ('basic_yearly','enterprise_yearly') THEN 'year'
    ELSE 'month'
  END;

  IF v_order.tier::text = 'basic' THEN
    SELECT max(expires_at) INTO v_start
    FROM public.subscriptions
    WHERE (
        (v_order.workspace_id IS NOT NULL AND workspace_id = v_order.workspace_id)
        OR (v_order.workspace_id IS NULL AND workspace_id IS NULL AND user_id = v_order.user_id)
      )
      AND status::text = 'active'
      AND expires_at > v_now
      AND tier::text IN ('basic','pro');
  ELSE
    SELECT max(expires_at) INTO v_start
    FROM public.subscriptions
    WHERE (
        (v_order.workspace_id IS NOT NULL AND workspace_id = v_order.workspace_id)
        OR (v_order.workspace_id IS NULL AND workspace_id IS NULL AND user_id = v_order.user_id)
      )
      AND status::text = 'active'
      AND expires_at > v_now
      AND tier::text = 'pro';
  END IF;
  v_start := greatest(v_now, COALESCE(v_start, v_now));

  UPDATE public.subscriptions
  SET status = 'active',
      payment_status = 'success',
      provider_payment_id = p_provider_payment_id,
      provider_order_status = upper(p_provider_order_status),
      provider_payment_status = upper(p_provider_payment_status),
      started_at = v_start,
      expires_at = CASE WHEN v_period = 'year' THEN v_start + interval '1 year' ELSE v_start + interval '1 month' END,
      updated_at = v_now
  WHERE id = p_subscription_id
    AND status::text = 'created';

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
    v_order.user_id, v_order.user_email, v_order.workspace_id, v_order.txnid, v_order.id,
    'cashfree', 'cashfree', upper(p_currency), v_order.country_code, v_period,
    v_order.plan_id, v_order.plan_name, v_order.tier,
    CASE WHEN p_amount_minor <= 2147483647 THEN p_amount_minor::integer ELSE NULL END,
    p_amount_minor, (p_amount_minor::numeric / 100), v_order.locale_code,
    'success', 'applied', true, upper(p_provider_payment_status), upper(p_provider_order_status),
    p_provider_payment_id, COALESCE(p_raw, '{}'::jsonb), v_now, NULL,
    'Cashfree payment verified and subscription activated', COALESCE(p_source, 'cashfree-webhook')
  );

  RETURN jsonb_build_object('ok', true, 'already_applied', false);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_cashfree_subscription_payment(uuid,text,text,bigint,text,text,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cashfree_subscription_payment(uuid,text,text,bigint,text,text,jsonb,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.apply_cashfree_refund_event(
  p_subscription_id uuid,
  p_provider_refund_id text,
  p_amount_minor bigint,
  p_currency text,
  p_refund_status text,
  p_raw jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_order public.subscriptions%ROWTYPE;
  v_existing public.payment_refunds%ROWTYPE;
  v_has_existing boolean := false;
  v_original bigint;
  v_prior_total bigint;
  v_total bigint;
  v_status text := lower(COALESCE(p_refund_status, ''));
  v_next_status text;
  v_full boolean;
  v_rows integer;
BEGIN
  IF p_subscription_id IS NULL
     OR p_provider_refund_id IS NULL OR length(trim(p_provider_refund_id)) = 0
     OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR p_currency IS NULL OR upper(p_currency) NOT IN ('INR','USD','GBP','AED','CAD','AUD','SGD')
     OR v_status NOT IN ('pending','success','failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_refund_data');
  END IF;

  SELECT * INTO v_order
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'subscription_not_found');
  END IF;

  IF lower(COALESCE(v_order.gateway,'')) <> 'cashfree'
     OR lower(COALESCE(v_order.provider,'')) <> 'cashfree'
     OR upper(COALESCE(v_order.currency,'')) <> upper(p_currency) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_order_mismatch');
  END IF;

  v_original := COALESCE(
    v_order.amount_minor_units,
    CASE WHEN upper(v_order.currency) = 'INR' THEN v_order.amount_paise::bigint END
  );
  IF v_original IS NULL OR v_original <= 0 OR p_amount_minor > v_original THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_amount_invalid');
  END IF;

  SELECT * INTO v_existing
  FROM public.payment_refunds
  WHERE provider = 'cashfree' AND provider_refund_id = p_provider_refund_id
  FOR UPDATE;
  v_has_existing := FOUND;

  IF v_has_existing AND v_existing.subscription_id <> p_subscription_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_id_already_used');
  END IF;

  IF v_has_existing AND v_existing.status = 'success' THEN
    IF v_status <> 'success' THEN
      RETURN jsonb_build_object('ok', true, 'already_applied', true, 'reason', 'refund_already_finalized');
    END IF;
    IF v_existing.amount_minor_units <> p_amount_minor THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'refund_amount_conflict');
    END IF;
    RETURN jsonb_build_object('ok', true, 'already_applied', true);
  END IF;

  IF v_has_existing AND v_existing.status = 'failed' AND v_status = 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'already_applied', true, 'reason', 'stale_refund_event');
  END IF;

  SELECT COALESCE(sum(amount_minor_units), 0)::bigint INTO v_prior_total
  FROM public.payment_refunds
  WHERE subscription_id = p_subscription_id
    AND status = 'success'
    AND provider_refund_id <> p_provider_refund_id;

  v_total := v_prior_total + CASE WHEN v_status = 'success' THEN p_amount_minor ELSE 0 END;
  IF v_total > v_original THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cumulative_refund_exceeds_payment');
  END IF;

  INSERT INTO public.payment_refunds AS refund_row (
    subscription_id, user_id, workspace_id, provider, provider_refund_id,
    amount_minor_units, currency, status, raw, updated_at
  ) VALUES (
    v_order.id, v_order.user_id, v_order.workspace_id, 'cashfree', p_provider_refund_id,
    p_amount_minor, upper(p_currency), v_status, COALESCE(p_raw, '{}'::jsonb), clock_timestamp()
  )
  ON CONFLICT (provider, provider_refund_id) DO UPDATE SET
    amount_minor_units = EXCLUDED.amount_minor_units,
    currency = EXCLUDED.currency,
    status = EXCLUDED.status,
    raw = EXCLUDED.raw,
    updated_at = EXCLUDED.updated_at
  WHERE refund_row.subscription_id = EXCLUDED.subscription_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_id_already_used');
  END IF;

  v_full := v_total >= v_original;
  v_next_status := CASE
    WHEN v_full THEN 'success'
    WHEN v_total > 0 THEN 'partially_refunded'
    ELSE v_status
  END;

  UPDATE public.subscriptions
  SET refund_status = v_next_status,
      payment_status = CASE
        WHEN v_full THEN 'refunded'
        WHEN v_total > 0 THEN 'partially_refunded'
        ELSE payment_status
      END,
      refunded_at = CASE WHEN v_full THEN clock_timestamp() ELSE NULL END,
      status = CASE WHEN v_full THEN 'failed' ELSE status END,
      updated_at = clock_timestamp()
  WHERE id = v_order.id;

  UPDATE public.payment_logs
  SET refund_status = v_next_status,
      refund_amount_minor_units = v_total,
      updated_at = clock_timestamp()
  WHERE subscription_id = v_order.id AND provider = 'cashfree';

  RETURN jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'refund_status', v_next_status,
    'refunded_minor_units', v_total,
    'fully_refunded', v_full
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)
  TO service_role;

-- Assert the hardened function configuration and explicit execution boundary.
DO $$
DECLARE
  v_config text[];
BEGIN
  SELECT proconfig INTO v_config
  FROM pg_catalog.pg_proc
  WHERE oid = 'public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)'::regprocedure;
  IF v_config IS NULL OR NOT ('search_path=pg_catalog, pg_temp' = ANY(v_config)) THEN
    RAISE EXCEPTION 'Refund RPC search_path is not hardened';
  END IF;
  IF has_function_privilege('anon', 'public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Refund RPC must not be executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must retain refund RPC execution';
  END IF;
END
$$;
