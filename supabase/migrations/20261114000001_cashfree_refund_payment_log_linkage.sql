-- Targeted Cashfree refund-to-payment-log accounting correction.
-- Resolve only exact Cashfree order + cf_payment_id matches. Ambiguous historical rows remain flagged.

-- Previous versions wrote a subscription aggregate to every Cashfree payment log.
-- Clear those copied values, then rebuild only records with an exact ledger link.
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
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.amount_minor_units IS DISTINCT FROM OLD.amount_minor_units
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR (
       NEW.payment_log_id IS DISTINCT FROM OLD.payment_log_id
       AND NOT (
         OLD.payment_log_id IS NULL
         AND NEW.payment_log_id IS NOT NULL
         AND current_user = 'postgres'
         AND current_setting('app.cashfree_refund_reconciliation', true) = 'on'
       )
     ) THEN
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
AS $cashfree_payment_log_identity$
BEGIN
  IF OLD.provider = 'cashfree'
     AND OLD.gateway = 'cashfree'
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR (NEW.subscription_id IS DISTINCT FROM OLD.subscription_id AND NEW.subscription_id IS NOT NULL)
       OR NEW.txnid IS DISTINCT FROM OLD.txnid
       OR NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.gateway IS DISTINCT FROM OLD.gateway
       OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
     ) THEN
    RAISE EXCEPTION 'Cashfree payment-log identity is immutable';
  END IF;
  RETURN NEW;
END;
$cashfree_payment_log_identity$;

DROP TRIGGER IF EXISTS cashfree_payment_logs_identity_immutable
  ON public.payment_logs;
CREATE TRIGGER cashfree_payment_logs_identity_immutable
BEFORE UPDATE OF id, subscription_id, txnid, provider, gateway, provider_payment_id, amount, currency
ON public.payment_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_cashfree_payment_log_identity_change();

CREATE TABLE IF NOT EXISTS public.cashfree_refund_reconciliation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.payment_refunds(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  payment_log_id uuid NOT NULL REFERENCES public.payment_logs(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action = 'verified_null_to_link'),
  reconciled_by text NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.cashfree_refund_reconciliation_audit FROM PUBLIC, anon, authenticated, service_role;

-- Snapshot provider/gateway mismatches and Cashfree rows whose prior totals
-- cannot be reconstructed from linked Cashfree refund-ledger entries.
CREATE TABLE IF NOT EXISTS public.cashfree_refund_cleanup_exceptions (
  payment_log_id uuid PRIMARY KEY REFERENCES public.payment_logs(id) ON DELETE RESTRICT,
  provider text,
  gateway text,
  prior_refund_status text,
  prior_refund_amount_minor_units bigint,
  reason text NOT NULL CHECK (reason IN ('provider_gateway_mismatch','cashfree_ledger_missing','cashfree_ledger_incomplete')),
  detected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.cashfree_refund_cleanup_exceptions FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.cashfree_refund_cleanup_exceptions
  (payment_log_id, provider, gateway, prior_refund_status, prior_refund_amount_minor_units, reason)
SELECT l.id, l.provider, l.gateway, l.refund_status, l.refund_amount_minor_units,
       'provider_gateway_mismatch'
FROM public.payment_logs l
WHERE (l.provider = 'cashfree' AND l.gateway IS DISTINCT FROM 'cashfree')
   OR (l.gateway = 'cashfree' AND l.provider IS DISTINCT FROM 'cashfree')
ON CONFLICT (payment_log_id) DO NOTHING;

INSERT INTO public.cashfree_refund_cleanup_exceptions
  (payment_log_id, provider, gateway, prior_refund_status, prior_refund_amount_minor_units, reason)
SELECT l.id, l.provider, l.gateway, l.refund_status, l.refund_amount_minor_units,
       'cashfree_ledger_missing'
FROM public.payment_logs l
WHERE l.provider = 'cashfree'
  AND l.gateway = 'cashfree'
  AND (l.refund_status IS NOT NULL OR l.refund_amount_minor_units IS NOT NULL)
  AND l.refund_status IS DISTINCT FROM 'reconciliation_required'
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_refunds r
    WHERE r.payment_log_id = l.id AND r.provider = 'cashfree'
  )
ON CONFLICT (payment_log_id) DO NOTHING;

INSERT INTO public.cashfree_refund_cleanup_exceptions
  (payment_log_id, provider, gateway, prior_refund_status, prior_refund_amount_minor_units, reason)
SELECT l.id, l.provider, l.gateway, l.refund_status, l.refund_amount_minor_units,
       'cashfree_ledger_incomplete'
FROM public.payment_logs l
WHERE l.provider = 'cashfree' AND l.gateway = 'cashfree'
  AND l.refund_status IS DISTINCT FROM 'reconciliation_required'
  AND (l.refund_status IS NOT NULL OR l.refund_amount_minor_units IS NOT NULL)
  AND l.refund_amount_minor_units IS DISTINCT FROM (
    SELECT COALESCE(sum(r.amount_minor_units) FILTER (WHERE r.status = 'success'), 0)::bigint
    FROM public.payment_refunds r
    WHERE r.payment_log_id = l.id AND r.provider = 'cashfree'
  )
ON CONFLICT (payment_log_id) DO NOTHING;


CREATE OR REPLACE FUNCTION public.reconcile_cashfree_refund_payment_log(p_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $reconcile$
DECLARE
  v_refund public.payment_refunds%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_refund_subscription_id uuid;
  v_payment_log_id uuid;
  v_match_count integer;
  v_rows integer;
  v_subscription_total bigint;
  v_subscription_original bigint;
BEGIN
  SELECT subscription_id INTO v_refund_subscription_id
  FROM public.payment_refunds
  WHERE id = p_refund_id AND provider = 'cashfree';
  IF NOT FOUND OR v_refund_subscription_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'historical_refund_not_found');
  END IF;

  SELECT * INTO v_subscription
  FROM public.subscriptions
  WHERE id = v_refund_subscription_id
  FOR UPDATE;
  IF NOT FOUND OR v_subscription.provider IS DISTINCT FROM 'cashfree'
     OR v_subscription.gateway IS DISTINCT FROM 'cashfree' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'historical_refund_mapping_not_found');
  END IF;

  SELECT * INTO v_refund
  FROM public.payment_refunds
  WHERE id = p_refund_id AND provider = 'cashfree'
  FOR UPDATE;
  IF NOT FOUND OR v_refund.subscription_id IS DISTINCT FROM v_subscription.id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'historical_refund_not_found');
  END IF;
  IF v_refund.payment_log_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_reconciled', true);
  END IF;

  SELECT count(*), (array_agg(l.id ORDER BY l.id))[1]
  INTO v_match_count, v_payment_log_id
  FROM public.payment_logs l
  WHERE l.subscription_id = v_subscription.id
    AND l.txnid = v_subscription.txnid
    AND l.provider = 'cashfree'
    AND l.gateway = 'cashfree'
    AND l.provider_payment_id = NULLIF(trim(v_refund.raw #>> '{data,refund,cf_payment_id}'), '')
    AND NULLIF(trim(v_refund.raw #>> '{data,refund,order_id}'), '') = v_subscription.txnid;

  IF v_match_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'historical_refund_mapping_not_found');
  ELSIF v_match_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'historical_refund_mapping_ambiguous');
  END IF;

  PERFORM set_config('app.cashfree_refund_reconciliation', 'on', true);
  UPDATE public.payment_refunds
  SET payment_log_id = v_payment_log_id
  WHERE id = v_refund.id AND payment_log_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('app.cashfree_refund_reconciliation', 'off', true);

  IF v_rows <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'historical_refund_reconciliation_race');
  END IF;

  INSERT INTO public.cashfree_refund_reconciliation_audit
    (refund_id, subscription_id, payment_log_id, action, reconciled_by)
  VALUES
    (v_refund.id, v_refund.subscription_id, v_payment_log_id, 'verified_null_to_link',
    COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), session_user));

  -- Rebuild aggregate values and clear the hold only after every historical
  -- Cashfree refund for this subscription has an exact verified payment link.
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_refunds unresolved
    WHERE unresolved.subscription_id = v_refund.subscription_id
      AND unresolved.provider = 'cashfree'
      AND unresolved.payment_log_id IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.cashfree_refund_cleanup_exceptions e
    JOIN public.payment_logs l ON l.id = e.payment_log_id
    WHERE l.subscription_id = v_refund.subscription_id
      AND e.reason IN ('cashfree_ledger_missing','cashfree_ledger_incomplete')
  ) THEN
    UPDATE public.payment_logs l
    SET refund_amount_minor_units = COALESCE((
          SELECT sum(r.amount_minor_units)
          FROM public.payment_refunds r
          WHERE r.payment_log_id = l.id
            AND r.provider = 'cashfree'
            AND r.status = 'success'
        ), 0)::bigint,
        refund_status = CASE
          WHEN COALESCE((SELECT sum(r.amount_minor_units) FROM public.payment_refunds r
                         WHERE r.payment_log_id = l.id AND r.provider = 'cashfree' AND r.status = 'success'),0) >= l.amount THEN 'success'
          WHEN COALESCE((SELECT sum(r.amount_minor_units) FROM public.payment_refunds r
                         WHERE r.payment_log_id = l.id AND r.provider = 'cashfree' AND r.status = 'success'),0) > 0 THEN 'partially_refunded'
          WHEN EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.payment_log_id = l.id AND r.provider = 'cashfree' AND r.status = 'pending') THEN 'pending'
          WHEN EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.payment_log_id = l.id AND r.provider = 'cashfree' AND r.status = 'failed') THEN 'failed'
          ELSE NULL
        END
    WHERE l.subscription_id = v_refund.subscription_id
      AND l.provider = 'cashfree' AND l.gateway = 'cashfree'
      AND (
        (l.refund_status IS NULL AND l.refund_amount_minor_units IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.payment_refunds linked
          WHERE linked.payment_log_id = l.id AND linked.provider = 'cashfree'
        )
      );

    -- If the hold is gone but a log has no linked ledger, restore its audited
    -- legacy status (if any) and retain its unreconstructable amount unchanged.
    UPDATE public.payment_logs l
    SET refund_status = (
      SELECT e.prior_refund_status
      FROM public.cashfree_refund_cleanup_exceptions e
      WHERE e.payment_log_id = l.id
        AND e.reason = 'cashfree_ledger_missing'
    )
    WHERE l.subscription_id = v_refund.subscription_id
      AND l.provider = 'cashfree' AND l.gateway = 'cashfree'
      AND l.refund_status = 'reconciliation_required'
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_refunds linked
        WHERE linked.payment_log_id = l.id AND linked.provider = 'cashfree'
      );

    SELECT COALESCE(sum(amount_minor_units) FILTER (WHERE status = 'success'), 0)::bigint
    INTO v_subscription_total
    FROM public.payment_refunds
    WHERE subscription_id = v_refund.subscription_id AND provider = 'cashfree';
    v_subscription_original := COALESCE(
      v_subscription.amount_minor_units,
      CASE WHEN upper(v_subscription.currency) = 'INR' THEN v_subscription.amount_paise::bigint END
    );
    UPDATE public.subscriptions
    SET refund_status = CASE
          WHEN v_subscription_total >= v_subscription_original THEN 'success'
          WHEN v_subscription_total > 0 THEN 'partially_refunded'
          ELSE NULL
        END,
        payment_status = CASE
          WHEN v_subscription_total >= v_subscription_original THEN 'refunded'
          WHEN v_subscription_total > 0 THEN 'partially_refunded'
          ELSE payment_status
        END,
        refunded_at = CASE
          WHEN v_subscription_total >= v_subscription_original THEN COALESCE(refunded_at, clock_timestamp())
          ELSE NULL
        END,
        status = CASE WHEN v_subscription_total >= v_subscription_original THEN 'failed' ELSE status END,
        updated_at = clock_timestamp()
    WHERE id = v_subscription.id;
  ELSE
    UPDATE public.payment_logs l
    SET refund_status = 'reconciliation_required'
    WHERE l.subscription_id = v_refund.subscription_id
      AND l.provider = 'cashfree' AND l.gateway = 'cashfree';
  END IF;

  RETURN jsonb_build_object('ok', true, 'reconciled', true, 'payment_log_id', v_payment_log_id);
END;
$reconcile$;

REVOKE ALL ON FUNCTION public.reconcile_cashfree_refund_payment_log(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_cashfree_refund_payment_log(uuid)
  TO service_role;

-- Deterministically resolvable legacy rows are linked through the audited,
-- narrowly-scoped reconciliation function. Ambiguous/unmatched rows remain NULL.
DO $reconcile$
DECLARE v_refund_id uuid;
BEGIN
  FOR v_refund_id IN
    SELECT id FROM public.payment_refunds
    WHERE provider = 'cashfree' AND payment_log_id IS NULL
    ORDER BY id
  LOOP
    PERFORM public.reconcile_cashfree_refund_payment_log(v_refund_id);
  END LOOP;
END
$reconcile$;

-- Rebuild only homogeneous Cashfree logs whose existing refund metadata is
-- absent or can be reconstructed from the linked Cashfree refund ledger.
-- Preserve all existing totals when the ledger cannot prove their source.
UPDATE public.payment_logs l
SET refund_status = NULL,
    refund_amount_minor_units = NULL
WHERE l.provider = 'cashfree'
  AND l.gateway = 'cashfree'
  AND NOT EXISTS (
    SELECT 1 FROM public.cashfree_refund_cleanup_exceptions e
    WHERE e.payment_log_id = l.id
      AND e.reason IN ('cashfree_ledger_missing','cashfree_ledger_incomplete')
  )
  AND (
    (l.refund_status IS NULL AND l.refund_amount_minor_units IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.payment_refunds r
      WHERE r.payment_log_id = l.id AND r.provider = 'cashfree'
    )
  );

WITH payment_totals AS (
  SELECT
    r.payment_log_id,
    COALESCE(sum(r.amount_minor_units) FILTER (WHERE r.status = 'success'), 0)::bigint AS refunded_minor,
    bool_or(r.status = 'pending') AS has_pending,
    bool_or(r.status = 'failed') AS has_failed
  FROM public.payment_refunds r
  JOIN public.payment_logs linked
    ON linked.id = r.payment_log_id
   AND linked.provider = 'cashfree'
   AND linked.gateway = 'cashfree'
  WHERE r.provider = 'cashfree'
    AND r.payment_log_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.cashfree_refund_cleanup_exceptions e
      WHERE e.payment_log_id = r.payment_log_id
        AND e.reason IN ('cashfree_ledger_missing','cashfree_ledger_incomplete')
    )
  GROUP BY r.payment_log_id
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

UPDATE public.payment_logs l
SET refund_status = 'reconciliation_required'
WHERE l.provider = 'cashfree' AND l.gateway = 'cashfree'
  AND EXISTS (
    SELECT 1 FROM public.cashfree_refund_cleanup_exceptions e
    WHERE e.payment_log_id = l.id
      AND e.reason IN ('cashfree_ledger_missing','cashfree_ledger_incomplete')
  );

-- Leave a stable marker on strict Cashfree attempts while any historical
-- Cashfree refund for the subscription remains unlinked.
UPDATE public.payment_logs l
SET refund_status = 'reconciliation_required'
WHERE l.provider = 'cashfree' AND l.gateway = 'cashfree'
  AND EXISTS (
    SELECT 1 FROM public.payment_refunds r
    WHERE r.subscription_id = l.subscription_id
      AND r.provider = 'cashfree'
      AND r.payment_log_id IS NULL
  );

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

  v_cf_payment_id := NULLIF(trim(p_raw #>> '{data,refund,cf_payment_id}'), '');
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

  -- Do not accept another refund while any historical Cashfree ledger row for
  -- this subscription is unresolved; this check precedes all accounting writes.
  IF EXISTS (
    SELECT 1 FROM public.payment_refunds r
    WHERE r.subscription_id = v_order.id
      AND r.provider = 'cashfree'
      AND r.payment_log_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.cashfree_refund_cleanup_exceptions e
    JOIN public.payment_logs l ON l.id = e.payment_log_id
    WHERE l.subscription_id = v_order.id
      AND e.reason IN ('cashfree_ledger_missing','cashfree_ledger_incomplete')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'historical_refund_reconciliation_required');
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

REVOKE ALL ON FUNCTION public.reconcile_cashfree_refund_payment_log(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_cashfree_refund_payment_log(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cashfree_refund_event(uuid,text,bigint,text,text,jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.prevent_cashfree_refund_identity_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_cashfree_payment_log_identity_change()
  FROM PUBLIC, anon, authenticated;
