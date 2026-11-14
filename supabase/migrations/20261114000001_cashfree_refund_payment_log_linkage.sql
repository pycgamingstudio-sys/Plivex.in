-- Targeted Cashfree refund-to-payment-log accounting correction.
-- Resolve only exact Cashfree order + cf_payment_id matches. Ambiguous historical rows remain flagged.

WITH exact_matches AS (
  SELECT
    r.id AS refund_id,
    (array_agg(l.id ORDER BY l.id))[1] AS payment_log_id,
    count(l.id) AS match_count
  FROM public.payment_refunds r
  JOIN public.subscriptions s ON s.id = r.subscription_id
  JOIN public.payment_logs l
    ON l.subscription_id = s.id
   AND l.txnid = s.txnid
   AND l.provider = 'cashfree'
   AND l.gateway = 'cashfree'
   AND l.provider_payment_id = NULLIF(r.raw #>> '{data,refund,cf_payment_id}', '')
  WHERE r.provider = 'cashfree'
    AND r.payment_log_id IS NULL
    AND NULLIF(r.raw #>> '{data,refund,order_id}', '') = s.txnid
  GROUP BY r.id
)
UPDATE public.payment_refunds r
SET payment_log_id = m.payment_log_id
FROM exact_matches m
WHERE r.id = m.refund_id
  AND m.match_count = 1;

-- Previous versions wrote a subscription aggregate to every Cashfree payment log.
-- Clear those copied values, then rebuild only records with an exact ledger link.
UPDATE public.payment_logs
SET refund_status = NULL,
    refund_amount_minor_units = NULL
WHERE provider = 'cashfree' OR gateway = 'cashfree';

WITH payment_totals AS (
  SELECT
    payment_log_id,
    COALESCE(sum(amount_minor_units) FILTER (WHERE status = 'success'), 0)::bigint AS refunded_minor,
    bool_or(status = 'pending') AS has_pending,
    bool_or(status = 'failed') AS has_failed
  FROM public.payment_refunds
  WHERE provider = 'cashfree'
    AND payment_log_id IS NOT NULL
  GROUP BY payment_log_id
)
UPDATE public.payment_logs l
SET refund_amount_minor_units = t.refunded_minor,
    refund_status = CASE
      WHEN t.refunded_minor >= l.amount THEN 'success'
      WHEN t.refunded_minor > 0 THEN 'partially_refunded'
      WHEN t.has_pending THEN 'pending'
      WHEN t.has_failed THEN 'failed'
      ELSE NULL
    END
FROM payment_totals t
WHERE l.id = t.payment_log_id;

-- An unlinked historical refund makes every attempt for that order unsafe to reconcile.
UPDATE public.payment_logs l
SET refund_status = 'reconciliation_required'
WHERE (l.provider = 'cashfree' OR l.gateway = 'cashfree')
  AND EXISTS (
    SELECT 1
    FROM public.payment_refunds r
    WHERE r.subscription_id = l.subscription_id
      AND r.provider = 'cashfree'
      AND r.payment_log_id IS NULL
  );

-- NOT VALID preserves any legacy ambiguous rows, while enforcing linkage on all new/updated rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_refunds'::regclass
      AND conname = 'payment_refunds_payment_log_required'
  ) THEN
    ALTER TABLE public.payment_refunds
      ADD CONSTRAINT payment_refunds_payment_log_required
      CHECK (payment_log_id IS NOT NULL) NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS payment_logs_cashfree_refund_lookup_idx
  ON public.payment_logs (subscription_id, txnid, provider_payment_id)
  WHERE provider = 'cashfree' AND gateway = 'cashfree';

CREATE INDEX IF NOT EXISTS payment_refunds_payment_log_status_idx
  ON public.payment_refunds (payment_log_id, status);

CREATE OR REPLACE FUNCTION public.prevent_cashfree_refund_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.payment_log_id IS DISTINCT FROM OLD.payment_log_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.amount_minor_units IS DISTINCT FROM OLD.amount_minor_units
     OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'Cashfree refund identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_refunds_identity_immutable
  ON public.payment_refunds;
CREATE TRIGGER payment_refunds_identity_immutable
BEFORE UPDATE OF subscription_id, payment_log_id, provider, provider_refund_id,
                 user_id, workspace_id, amount_minor_units, currency
ON public.payment_refunds
FOR EACH ROW
EXECUTE FUNCTION public.prevent_cashfree_refund_identity_change();


CREATE OR REPLACE FUNCTION public.prevent_cashfree_payment_log_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $
BEGIN
  IF OLD.provider = 'cashfree'
     AND OLD.gateway = 'cashfree'
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
       OR NEW.txnid IS DISTINCT FROM OLD.txnid
       OR NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.gateway IS DISTINCT FROM OLD.gateway
       OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
     ) THEN
    RAISE EXCEPTION 'Cashfree payment-log identity is immutable';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS cashfree_payment_logs_identity_immutable
  ON public.payment_logs;
CREATE TRIGGER cashfree_payment_logs_identity_immutable
BEFORE UPDATE OF id, subscription_id, txnid, provider, gateway, provider_payment_id
ON public.payment_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_cashfree_payment_log_identity_change();

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
  v_payment_log public.payment_logs%ROWTYPE;
  v_existing public.payment_refunds%ROWTYPE;
  v_has_existing boolean := false;
  v_cf_payment_id text;
  v_refund_order_id text;
  v_payment_log_count integer;
  v_subscription_original bigint;
  v_payment_original bigint;
  v_prior_subscription_total bigint;
  v_subscription_total bigint;
  v_prior_payment_total bigint;
  v_payment_total bigint;
  v_status text := lower(COALESCE(p_refund_status, ''));
  v_subscription_next_status text;
  v_payment_next_status text;
  v_full_subscription boolean;
  v_full_payment boolean;
  v_rows integer;
BEGIN
  IF p_subscription_id IS NULL
     OR p_provider_refund_id IS NULL OR length(trim(p_provider_refund_id)) = 0
     OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR p_currency IS NULL OR upper(p_currency) NOT IN ('INR','USD','GBP','AED','CAD','AUD','SGD')
     OR v_status NOT IN ('pending','success','failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_refund_data');
  END IF;

  v_cf_payment_id := NULLIF(trim(COALESCE(
    p_raw #>> '{data,refund,cf_payment_id}',
    p_raw #>> '{data,refund,payment_id}'
  )), '');
  v_refund_order_id := NULLIF(trim(COALESCE(
    p_raw #>> '{data,refund,order_id}',
    p_raw #>> '{data,order,order_id}'
  )), '');
  IF v_cf_payment_id IS NULL OR v_refund_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_mapping_missing');
  END IF;

  SELECT * INTO v_order
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'subscription_not_found');
  END IF;

  IF v_refund_order_id IS DISTINCT FROM v_order.txnid
     OR lower(COALESCE(v_order.gateway,'')) <> 'cashfree'
     OR lower(COALESCE(v_order.provider,'')) <> 'cashfree'
     OR upper(COALESCE(v_order.currency,'')) <> upper(p_currency) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_order_mismatch');
  END IF;

  SELECT count(*) INTO v_payment_log_count
  FROM public.payment_logs
  WHERE subscription_id = v_order.id
    AND txnid = v_order.txnid
    AND provider = 'cashfree'
    AND gateway = 'cashfree'
    AND provider_payment_id = v_cf_payment_id;

  IF v_payment_log_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_mapping_not_found');
  ELSIF v_payment_log_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_mapping_ambiguous');
  END IF;

  SELECT * INTO v_payment_log
  FROM public.payment_logs
  WHERE subscription_id = v_order.id
    AND txnid = v_order.txnid
    AND provider = 'cashfree'
    AND gateway = 'cashfree'
    AND provider_payment_id = v_cf_payment_id;

  IF v_payment_log.amount IS NULL OR v_payment_log.amount <= 0
     OR upper(COALESCE(v_payment_log.currency,'')) <> upper(p_currency) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_log_amount_invalid');
  END IF;

  SELECT * INTO v_existing
  FROM public.payment_refunds
  WHERE provider = 'cashfree'
    AND provider_refund_id = p_provider_refund_id
  FOR UPDATE;
  v_has_existing := FOUND;

  IF v_has_existing AND v_existing.subscription_id <> p_subscription_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_id_already_used');
  END IF;

  IF v_has_existing AND v_existing.payment_log_id IS DISTINCT FROM v_payment_log.id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_payment_mapping_conflict');
  END IF;

  IF v_has_existing AND (
    v_existing.amount_minor_units IS DISTINCT FROM p_amount_minor
    OR upper(COALESCE(v_existing.currency, '')) IS DISTINCT FROM upper(p_currency)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_amount_conflict');
  END IF;

  v_subscription_original := COALESCE(
    v_order.amount_minor_units,
    CASE WHEN upper(v_order.currency) = 'INR' THEN v_order.amount_paise::bigint END
  );
  v_payment_original := v_payment_log.amount::bigint;

  IF v_subscription_original IS NULL OR v_subscription_original <= 0
     OR v_payment_original IS NULL OR v_payment_original <= 0
     OR p_amount_minor > v_payment_original
     OR p_amount_minor > v_subscription_original THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_amount_invalid');
  END IF;

  IF v_has_existing AND v_existing.status = 'success' THEN
    IF v_status <> 'success' THEN
      RETURN jsonb_build_object('ok', true, 'already_applied', true, 'reason', 'refund_already_finalized');
    END IF;
    RETURN jsonb_build_object('ok', true, 'already_applied', true);
  END IF;

  IF v_has_existing AND v_existing.status = 'failed' AND v_status = 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'already_applied', true, 'reason', 'stale_refund_event');
  END IF;

  SELECT COALESCE(sum(amount_minor_units), 0)::bigint
  INTO v_prior_payment_total
  FROM public.payment_refunds
  WHERE payment_log_id = v_payment_log.id
    AND status = 'success'
    AND provider_refund_id <> p_provider_refund_id;

  SELECT COALESCE(sum(amount_minor_units), 0)::bigint
  INTO v_prior_subscription_total
  FROM public.payment_refunds
  WHERE subscription_id = p_subscription_id
    AND status = 'success'
    AND provider_refund_id <> p_provider_refund_id;

  v_payment_total := v_prior_payment_total
    + CASE WHEN v_status = 'success' THEN p_amount_minor ELSE 0 END;
  v_subscription_total := v_prior_subscription_total
    + CASE WHEN v_status = 'success' THEN p_amount_minor ELSE 0 END;

  IF v_payment_total > v_payment_original THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cumulative_refund_exceeds_payment_log');
  END IF;
  IF v_subscription_total > v_subscription_original THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cumulative_refund_exceeds_payment');
  END IF;

  INSERT INTO public.payment_refunds AS refund_row (
    subscription_id, payment_log_id, user_id, workspace_id, provider,
    provider_refund_id, amount_minor_units, currency, status, raw, updated_at
  ) VALUES (
    v_order.id, v_payment_log.id, v_order.user_id, v_order.workspace_id, 'cashfree',
    p_provider_refund_id, p_amount_minor, upper(p_currency), v_status,
    COALESCE(p_raw, '{}'::jsonb), clock_timestamp()
  )
  ON CONFLICT (provider, provider_refund_id) DO UPDATE SET
    status = EXCLUDED.status,
    raw = EXCLUDED.raw,
    updated_at = EXCLUDED.updated_at
  WHERE refund_row.subscription_id = EXCLUDED.subscription_id
    AND refund_row.payment_log_id = EXCLUDED.payment_log_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_payment_mapping_conflict');
  END IF;

  v_full_payment := v_payment_total >= v_payment_original;
  v_payment_next_status := CASE
    WHEN v_full_payment THEN 'success'
    WHEN v_payment_total > 0 THEN 'partially_refunded'
    ELSE v_status
  END;

  v_full_subscription := v_subscription_total >= v_subscription_original;
  v_subscription_next_status := CASE
    WHEN v_full_subscription THEN 'success'
    WHEN v_subscription_total > 0 THEN 'partially_refunded'
    ELSE v_status
  END;

  UPDATE public.payment_logs
  SET refund_status = v_payment_next_status,
      refund_amount_minor_units = v_payment_total
  WHERE id = v_payment_log.id;

  UPDATE public.subscriptions
  SET refund_status = v_subscription_next_status,
      payment_status = CASE
        WHEN v_full_subscription THEN 'refunded'
        WHEN v_subscription_total > 0 THEN 'partially_refunded'
        ELSE payment_status
      END,
      refunded_at = CASE
        WHEN v_full_subscription THEN COALESCE(refunded_at, clock_timestamp())
        ELSE NULL
      END,
      status = CASE WHEN v_full_subscription THEN 'failed' ELSE status END,
      updated_at = clock_timestamp()
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'refund_status', v_subscription_next_status,
    'refunded_minor_units', v_subscription_total,
    'payment_refunded_minor_units', v_payment_total,
    'fully_refunded', v_full_subscription,
    'payment_fully_refunded', v_full_payment
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.prevent_cashfree_refund_identity_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_cashfree_payment_log_identity_change()
  FROM PUBLIC, anon, authenticated;
