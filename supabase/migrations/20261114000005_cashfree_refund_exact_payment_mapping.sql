-- Exact Cashfree refund-to-payment mapping for multi-payment subscriptions.
-- Forward-only: replace the legacy subscription-wide RPC; preserve historical rows.
DROP FUNCTION IF EXISTS public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb);

CREATE OR REPLACE FUNCTION public.apply_cashfree_refund_event(
  p_subscription_id uuid,
  p_order_id text,
  p_provider_payment_id text,
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
  v_payment public.payment_logs%ROWTYPE;
  v_existing public.payment_refunds%ROWTYPE;
  v_payment_matches integer;
  v_has_existing boolean := false;
  v_payment_original bigint;
  v_payment_prior bigint;
  v_payment_total bigint;
  v_subscription_original bigint;
  v_subscription_prior bigint;
  v_subscription_total bigint;
  v_status text := lower(COALESCE(p_refund_status, ''));
  v_payment_status text;
  v_subscription_status text;
  v_full_payment boolean;
  v_full_subscription boolean;
  v_rows integer;
BEGIN
  IF p_subscription_id IS NULL
     OR p_order_id IS NULL OR length(trim(p_order_id)) = 0
     OR p_provider_payment_id IS NULL OR length(trim(p_provider_payment_id)) = 0
     OR p_provider_refund_id IS NULL OR length(trim(p_provider_refund_id)) = 0
     OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR p_currency IS NULL OR upper(p_currency) NOT IN ('INR','USD','GBP','AED','CAD','AUD','SGD')
     OR v_status NOT IN ('pending','success','failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_refund_data');
  END IF;

  -- All refund events for a subscription serialize on this row first.
  SELECT * INTO v_order
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'subscription_not_found');
  END IF;
  IF lower(COALESCE(v_order.gateway,'')) <> 'cashfree'
     OR lower(COALESCE(v_order.provider,'')) <> 'cashfree'
     OR upper(COALESCE(v_order.currency,'')) <> upper(p_currency)
     OR COALESCE(v_order.txnid,'') <> p_order_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_order_mismatch');
  END IF;

  -- Never guess which payment a historical unlinked refund belongs to.
  -- Require explicit reconciliation before accepting another refund.
  IF EXISTS (
    SELECT 1 FROM public.payment_refunds
    WHERE subscription_id = p_subscription_id AND payment_log_id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'historical_unlinked_refund');
  END IF;

  SELECT count(*) INTO v_payment_matches
  FROM public.payment_logs
  WHERE subscription_id = p_subscription_id
    AND provider = 'cashfree'
    AND gateway = 'cashfree'
    AND txnid = p_order_id
    AND provider_payment_id = p_provider_payment_id
    AND upper(COALESCE(currency,'')) = upper(p_currency)
    AND status = 'success'
    AND outcome::text = 'applied';
  IF v_payment_matches = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_log_not_found');
  ELSIF v_payment_matches <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ambiguous_payment_log');
  END IF;

  SELECT * INTO v_payment
  FROM public.payment_logs
  WHERE subscription_id = p_subscription_id
    AND provider = 'cashfree'
    AND gateway = 'cashfree'
    AND txnid = p_order_id
    AND provider_payment_id = p_provider_payment_id
    AND upper(COALESCE(currency,'')) = upper(p_currency)
    AND status = 'success'
    AND outcome::text = 'applied'
  FOR UPDATE;

  v_payment_original := v_payment.amount_minor_units;
  IF v_payment_original IS NULL OR v_payment_original <= 0 OR p_amount_minor > v_payment_original THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_amount_invalid');
  END IF;

  SELECT * INTO v_existing
  FROM public.payment_refunds
  WHERE provider = 'cashfree' AND provider_refund_id = p_provider_refund_id
  FOR UPDATE;
  v_has_existing := FOUND;

  IF v_has_existing AND (
    v_existing.subscription_id <> p_subscription_id
    OR v_existing.payment_log_id IS DISTINCT FROM v_payment.id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_id_already_used');
  END IF;
  IF v_has_existing AND (
    v_existing.amount_minor_units IS DISTINCT FROM p_amount_minor
    OR upper(COALESCE(v_existing.currency,'')) IS DISTINCT FROM upper(p_currency)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_amount_conflict');
  END IF;
  IF v_has_existing AND v_existing.status = 'success' THEN
    IF v_status <> 'success' THEN
      RETURN jsonb_build_object('ok', true, 'already_applied', true, 'reason', 'refund_already_finalized');
    END IF;
    RETURN jsonb_build_object('ok', true, 'already_applied', true,
      'payment_refunded_minor_units', COALESCE(v_payment.refund_amount_minor_units,0));
  END IF;
  IF v_has_existing AND v_existing.status = 'failed' AND v_status = 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'already_applied', true, 'reason', 'stale_refund_event');
  END IF;

  SELECT COALESCE(sum(amount_minor_units),0)::bigint INTO v_payment_prior
  FROM public.payment_refunds
  WHERE payment_log_id = v_payment.id
    AND status = 'success'
    AND provider_refund_id <> p_provider_refund_id;
  v_payment_total := v_payment_prior + CASE WHEN v_status = 'success' THEN p_amount_minor ELSE 0 END;
  IF v_payment_total > v_payment_original THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cumulative_refund_exceeds_payment');
  END IF;

  SELECT COALESCE(sum(amount_minor_units),0)::bigint INTO v_subscription_prior
  FROM public.payment_refunds
  WHERE subscription_id = p_subscription_id
    AND status = 'success'
    AND provider_refund_id <> p_provider_refund_id;
  v_subscription_total := v_subscription_prior + CASE WHEN v_status = 'success' THEN p_amount_minor ELSE 0 END;

  SELECT COALESCE(sum(amount_minor_units),0)::bigint INTO v_subscription_original
  FROM public.payment_logs
  WHERE subscription_id = p_subscription_id
    AND provider = 'cashfree'
    AND gateway = 'cashfree'
    AND status = 'success'
    AND outcome::text = 'applied';
  IF v_subscription_original <= 0 OR v_subscription_total > v_subscription_original THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cumulative_refund_exceeds_payment');
  END IF;

  INSERT INTO public.payment_refunds AS refund_row (
    subscription_id, payment_log_id, user_id, workspace_id, provider, provider_refund_id,
    amount_minor_units, currency, status, raw, updated_at
  ) VALUES (
    v_order.id, v_payment.id, v_order.user_id, v_order.workspace_id, 'cashfree', p_provider_refund_id,
    p_amount_minor, upper(p_currency), v_status, COALESCE(p_raw,'{}'::jsonb), clock_timestamp()
  )
  ON CONFLICT (provider, provider_refund_id) DO UPDATE SET
    status = EXCLUDED.status,
    raw = EXCLUDED.raw,
    updated_at = EXCLUDED.updated_at
  WHERE refund_row.subscription_id = EXCLUDED.subscription_id
    AND refund_row.payment_log_id = EXCLUDED.payment_log_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_id_already_used');
  END IF;

  v_full_payment := v_payment_total >= v_payment_original;
  v_payment_status := CASE
    WHEN v_full_payment THEN 'success'
    WHEN v_payment_total > 0 THEN 'partially_refunded'
    ELSE v_status
  END;
  v_full_subscription := v_subscription_total >= v_subscription_original;
  v_subscription_status := CASE
    WHEN v_full_subscription THEN 'success'
    WHEN v_subscription_total > 0 THEN 'partially_refunded'
    ELSE v_status
  END;

  UPDATE public.payment_logs
  SET refund_status = v_payment_status,
      refund_amount_minor_units = v_payment_total,
      updated_at = clock_timestamp()
  WHERE id = v_payment.id;

  UPDATE public.subscriptions
  SET refund_status = v_subscription_status,
      payment_status = CASE
        WHEN v_full_subscription THEN 'refunded'
        WHEN v_subscription_total > 0 THEN 'partially_refunded'
        ELSE payment_status
      END,
      refunded_at = CASE WHEN v_full_subscription THEN clock_timestamp() ELSE NULL END,
      status = CASE WHEN v_full_subscription THEN 'failed' ELSE status END,
      updated_at = clock_timestamp()
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'refund_status', v_subscription_status,
    'refunded_minor_units', v_subscription_total,
    'payment_refunded_minor_units', v_payment_total,
    'fully_refunded', v_full_subscription
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_cashfree_refund_event(uuid,text,text,text,bigint,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cashfree_refund_event(uuid,text,text,text,bigint,text,text,jsonb)
  TO service_role;

DO $$
DECLARE v_config text[];
BEGIN
  SELECT proconfig INTO v_config
  FROM pg_catalog.pg_proc
  WHERE oid = 'public.apply_cashfree_refund_event(uuid,text,text,text,bigint,text,text,jsonb)'::regprocedure;
  IF v_config IS NULL OR NOT ('search_path=pg_catalog, pg_temp' = ANY(v_config)) THEN
    RAISE EXCEPTION 'Exact-payment refund RPC search_path is not hardened';
  END IF;
  IF has_function_privilege('anon', 'public.apply_cashfree_refund_event(uuid,text,text,text,bigint,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_cashfree_refund_event(uuid,text,text,text,bigint,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Exact-payment refund RPC must not be executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.apply_cashfree_refund_event(uuid,text,text,text,bigint,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must retain exact-payment refund RPC execution';
  END IF;
END
$$;
