-- Isolated India-branch Cashfree refund support.
-- Adds only refund-specific schema; does not import Global billing/order migrations.
-- Existing PayU rows and subscription/payment flows are not rewritten.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS amount_minor_units bigint,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS refund_status text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

ALTER TABLE public.payment_logs
  ADD COLUMN IF NOT EXISTS refund_status text,
  ADD COLUMN IF NOT EXISTS refund_amount_minor_units bigint,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Preserve legacy India amounts as exact minor units without changing amount_paise.
UPDATE public.subscriptions
SET amount_minor_units = COALESCE(amount_minor_units, amount_paise::bigint)
WHERE upper(COALESCE(currency, '')) = 'INR'
  AND amount_paise IS NOT NULL;

UPDATE public.subscriptions
SET payment_status = CASE
  WHEN status::text = 'active' AND payment_status = 'created' THEN 'success'
  WHEN status::text = 'failed' AND payment_status = 'created' THEN 'failed'
  ELSE payment_status
END;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.subscriptions'::regclass AND conname='subscriptions_refund_payment_status_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_refund_payment_status_check
      CHECK (payment_status IN ('created','pending','success','failed','refunded','partially_refunded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.subscriptions'::regclass AND conname='subscriptions_refund_status_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_refund_status_check
      CHECK (refund_status IS NULL OR refund_status IN ('pending','success','failed','partially_refunded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.subscriptions'::regclass AND conname='subscriptions_refund_amount_minor_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_refund_amount_minor_check
      CHECK (amount_minor_units IS NULL OR amount_minor_units >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_logs'::regclass AND conname='payment_logs_refund_amount_minor_check') THEN
    ALTER TABLE public.payment_logs ADD CONSTRAINT payment_logs_refund_amount_minor_check
      CHECK (refund_amount_minor_units IS NULL OR refund_amount_minor_units >= 0);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  payment_log_id uuid REFERENCES public.payment_logs(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  workspace_id text,
  provider text NOT NULL DEFAULT 'cashfree' CHECK (provider = 'cashfree'),
  provider_refund_id text NOT NULL,
  amount_minor_units bigint NOT NULL CHECK (amount_minor_units > 0),
  currency text NOT NULL CHECK (currency IN ('INR','USD','GBP','AED','CAD','AUD','SGD')),
  status text NOT NULL CHECK (status IN ('pending','success','failed')),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_refunds_provider_refund_uidx UNIQUE (provider, provider_refund_id)
);

CREATE INDEX IF NOT EXISTS payment_refunds_subscription_status_idx
  ON public.payment_refunds (subscription_id, status);

ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own payment refunds read" ON public.payment_refunds;
CREATE POLICY "own payment refunds read" ON public.payment_refunds
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.payment_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_refunds TO authenticated;
GRANT ALL ON public.payment_refunds TO service_role;

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

  SELECT * INTO v_existing
  FROM public.payment_refunds
  WHERE provider = 'cashfree' AND provider_refund_id = p_provider_refund_id
  FOR UPDATE;
  v_has_existing := FOUND;

  IF v_has_existing AND v_existing.subscription_id <> p_subscription_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_id_already_used');
  END IF;

  IF v_has_existing AND (
    v_existing.amount_minor_units IS DISTINCT FROM p_amount_minor
    OR upper(COALESCE(v_existing.currency, '')) IS DISTINCT FROM upper(p_currency)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_amount_conflict');
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

  IF v_has_existing AND v_existing.status = 'success' THEN
    IF v_status <> 'success' THEN
      RETURN jsonb_build_object('ok', true, 'already_applied', true, 'reason', 'refund_already_finalized');
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

DO $$
DECLARE v_config text[];
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
