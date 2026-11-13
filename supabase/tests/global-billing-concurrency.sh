#!/usr/bin/env bash
set -euo pipefail

db="${PGDATABASE:-plivex_billing_concurrency_test}"
psql -v ON_ERROR_STOP=1 -d "$db" -c "BEGIN;
SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='ORDER-PARALLEL-1'),
 'CFPAY-PARALLEL-1','USD',599,'PAID','SUCCESS','{}'::jsonb,'ci-concurrency-1'
);
SELECT pg_sleep(2);
COMMIT;" >/tmp/plivex-renewal-first.log 2>&1 &
first_pid=$!

sleep 0.25
psql -v ON_ERROR_STOP=1 -d "$db" -c "SELECT public.apply_cashfree_subscription_payment(
 (SELECT id FROM public.subscriptions WHERE txnid='ORDER-PARALLEL-2'),
 'CFPAY-PARALLEL-2','USD',599,'PAID','SUCCESS','{}'::jsonb,'ci-concurrency-2'
);" >/tmp/plivex-renewal-second.log 2>&1

wait "$first_pid"

psql -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
DO $assert$
DECLARE
  v_prior_expiry timestamptz;
  v_first_start timestamptz;
  v_first_expiry timestamptz;
  v_second_start timestamptz;
  v_second_expiry timestamptz;
  v_active_count integer;
  v_payment_count integer;
BEGIN
  SELECT expires_at INTO v_prior_expiry
  FROM public.subscriptions WHERE txnid='PRIOR-ACTIVE' AND status='active';
  SELECT started_at,expires_at INTO v_first_start,v_first_expiry
  FROM public.subscriptions WHERE txnid='ORDER-PARALLEL-1' AND status='active';
  SELECT started_at,expires_at INTO v_second_start,v_second_expiry
  FROM public.subscriptions WHERE txnid='ORDER-PARALLEL-2' AND status='active';
  SELECT count(*) INTO v_active_count
  FROM public.subscriptions
  WHERE txnid IN ('ORDER-PARALLEL-1','ORDER-PARALLEL-2') AND status='active';
  SELECT count(*) INTO v_payment_count
  FROM public.payment_logs
  WHERE provider_payment_id IN ('CFPAY-PARALLEL-1','CFPAY-PARALLEL-2')
    AND outcome::text='applied';

  IF v_active_count <> 2 OR v_payment_count <> 2 THEN
    RAISE EXCEPTION 'Both paid renewal orders and ledger entries must apply; active %, payment logs %',
      v_active_count,v_payment_count;
  END IF;
  IF v_prior_expiry IS NULL OR v_first_start IS NULL OR v_first_expiry IS NULL
     OR v_second_start IS NULL OR v_second_expiry IS NULL
     OR v_first_start < v_prior_expiry OR v_second_start < v_first_expiry THEN
    RAISE EXCEPTION 'Concurrent renewals overlapped or skipped prior expiry: prior %, first start/expiry %/%, second start/expiry %/%',
      v_prior_expiry,v_first_start,v_first_expiry,v_second_start,v_second_expiry;
  END IF;
  IF v_first_expiry <> v_first_start + interval '1 month'
     OR v_second_expiry <> v_second_start + interval '1 month' THEN
    RAISE EXCEPTION 'A successful renewal did not receive its full one-month duration: first % to %, second % to %',
      v_first_start,v_first_expiry,v_second_start,v_second_expiry;
  END IF;
END
$assert$;
SQL
echo "PASS: concurrent workspace renewals were serialized without losing paid duration"
