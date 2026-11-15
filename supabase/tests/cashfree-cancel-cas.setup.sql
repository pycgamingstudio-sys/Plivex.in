-- Disposable PostgreSQL fixture for the Cashfree cancellation CAS predicate model.
-- This is not an HTTP handler integration test.
DROP TABLE IF EXISTS public.cashfree_cancel_cas_test;
CREATE TABLE public.cashfree_cancel_cas_test (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  gateway text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  cancel_at_period_end boolean,
  cancellation_requested_at timestamptz,
  updated_at timestamptz
);
INSERT INTO public.cashfree_cancel_cas_test
(id,workspace_id,gateway,provider,status,started_at,expires_at,cancel_at_period_end,cancellation_requested_at,updated_at)
VALUES ('sub-cas-1','workspace-cas','cashfree','cashfree','active',
        clock_timestamp()-interval '1 day',clock_timestamp()+interval '30 days',
        false,NULL,clock_timestamp()-interval '1 second');
