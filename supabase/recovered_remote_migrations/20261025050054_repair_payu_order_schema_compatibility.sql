-- Additive compatibility for the existing PayU server code.
-- Keep the PayU verification/hash logic untouched.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan text,
  ADD COLUMN IF NOT EXISTS txnid text,
  ADD COLUMN IF NOT EXISTS amount_paise integer,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS return_origin text,
  ADD COLUMN IF NOT EXISTS return_path text;

-- Preserve the established schema's required columns for inserts made by the order creator.
ALTER TABLE public.subscriptions
  ALTER COLUMN amount SET DEFAULT 0,
  ALTER COLUMN currency SET DEFAULT 'INR',
  ALTER COLUMN gateway SET DEFAULT 'payu';

-- A PayU transaction ID must identify at most one order. Keep existing payu_txnid uniqueness too.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_txnid_unique
  ON public.subscriptions (txnid)
  WHERE txnid IS NOT NULL;

-- Keep the legacy transaction identifier synchronized for integrations that still read it.
CREATE OR REPLACE FUNCTION public.sync_subscription_payu_txnid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.txnid IS NOT NULL THEN
    NEW.payu_txnid := NEW.txnid;
  ELSIF NEW.payu_txnid IS NOT NULL THEN
    NEW.txnid := NEW.payu_txnid;
  END IF;
  IF NEW.amount_paise IS NOT NULL AND (NEW.amount IS NULL OR NEW.amount = 0) THEN
    NEW.amount := (NEW.amount_paise / 100);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_subscription_payu_txnid ON public.subscriptions;
CREATE TRIGGER sync_subscription_payu_txnid
BEFORE INSERT OR UPDATE OF txnid, payu_txnid, amount_paise, amount
ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.sync_subscription_payu_txnid();

-- Read-only plan catalog for signed-in clients; usage counters remain server-only.
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_limits_authenticated_read ON public.plan_limits;
CREATE POLICY plan_limits_authenticated_read ON public.plan_limits
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS plan_features_authenticated_read ON public.plan_features;
CREATE POLICY plan_features_authenticated_read ON public.plan_features
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.usage_counters FROM anon, authenticated;
GRANT SELECT ON public.plan_limits, public.plan_features TO authenticated;
GRANT ALL ON public.plan_limits, public.plan_features, public.usage_counters TO service_role;
