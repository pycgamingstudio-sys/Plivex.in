DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_active_paid_dates_required'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_active_paid_dates_required
      CHECK (
        status::text <> 'active'
        OR tier::text = 'free'
        OR (
          started_at IS NOT NULL
          AND expires_at IS NOT NULL
          AND expires_at > started_at
        )
      );
  END IF;
END $$;

COMMENT ON CONSTRAINT subscriptions_active_paid_dates_required ON public.subscriptions IS
  'Paid subscriptions cannot be active without a valid start and expiry timestamp; missing dates must never grant indefinite paid access.';
