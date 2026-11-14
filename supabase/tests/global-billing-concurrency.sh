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

# Two independent sessions race refunds against one paid order. The first
# session acquires the subscription row lock before signaling readiness. The
# second session is not considered started until PostgreSQL reports that its
# refund RPC is actually waiting on that lock; only then is the first released.
race_dir="$(mktemp -d)"
ready_file="$race_dir/first-lock-acquired"
release_file="$race_dir/release-first"
cleanup_refund_race() {
  touch "$release_file"
  if [ -n "${refund_first_pid:-}" ]; then wait "$refund_first_pid" 2>/dev/null || true; fi
  if [ -n "${refund_second_pid:-}" ]; then wait "$refund_second_pid" 2>/dev/null || true; fi
  rm -rf "$race_dir"
}
trap cleanup_refund_race EXIT

PGAPPNAME=plivex-refund-first psql -v ON_ERROR_STOP=1 -d "$db" > /tmp/plivex-refund-first.log 2>&1 <<SQL &
SET ROLE service_role;
BEGIN;
SELECT id FROM public.subscriptions
 WHERE txnid='ORDER-REFUND-PARALLEL'
 FOR UPDATE;
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='ORDER-REFUND-PARALLEL'),
 'ORDER-REFUND-PARALLEL','CFPAY-REFUND-PARALLEL',
 'CFREFUND-PARALLEL-1',600,'USD','success','{"test":"concurrent-first"}'::jsonb
);
\! touch "$ready_file"
\! while [ ! -f "$release_file" ]; do sleep 0.05; done
COMMIT;
RESET ROLE;
SQL
refund_first_pid=$!

ready_deadline=$((SECONDS + 15))
until [ -f "$ready_file" ]; do
  if ! kill -0 "$refund_first_pid" 2>/dev/null; then
    cat /tmp/plivex-refund-first.log
    echo "ERROR: first refund session exited before acquiring its lock"
    exit 1
  fi
  if (( SECONDS >= ready_deadline )); then
    echo "ERROR: timed out waiting for first refund session to acquire its lock"
    exit 1
  fi
  sleep 0.05
done

PGAPPNAME=plivex-refund-second psql -v ON_ERROR_STOP=1 -d "$db" > /tmp/plivex-refund-second.log 2>&1 <<'SQL' &
SET ROLE service_role;
SELECT public.apply_cashfree_refund_event(
 (SELECT id FROM public.subscriptions WHERE txnid='ORDER-REFUND-PARALLEL'),
 'ORDER-REFUND-PARALLEL','CFPAY-REFUND-PARALLEL',
 'CFREFUND-PARALLEL-2',500,'USD','success','{"test":"concurrent-second"}'::jsonb
);
RESET ROLE;
SQL
refund_second_pid=$!

# Observe the second backend blocked on PostgreSQL's lock manager. This proves
# the race ordering instead of guessing with a fixed startup sleep.
lock_deadline=$((SECONDS + 15))
second_waiting=0
while (( SECONDS < lock_deadline )); do
  second_waiting="$(psql -Atq -d "$db" -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='plivex-refund-second' AND wait_event_type='Lock' AND query LIKE '%CFREFUND-PARALLEL-2%';")"
  if [ "$second_waiting" = "1" ]; then
    break
  fi
  if ! kill -0 "$refund_second_pid" 2>/dev/null; then
    cat /tmp/plivex-refund-second.log
    echo "ERROR: second refund session exited before PostgreSQL observed its lock wait"
    exit 1
  fi
  sleep 0.05
done
if [ "$second_waiting" != "1" ]; then
  echo "ERROR: timed out waiting for second refund session to block on the subscription lock"
  exit 1
fi

touch "$release_file"
wait "$refund_first_pid"
wait "$refund_second_pid"
refund_first_pid=""
refund_second_pid=""

if ! grep -q 'refunded_minor_units.*600' /tmp/plivex-refund-first.log; then
  cat /tmp/plivex-refund-first.log
  echo "ERROR: first concurrent refund was not applied as expected"
  exit 1
fi
if ! grep -q 'cumulative_refund_exceeds_payment' /tmp/plivex-refund-second.log; then
  cat /tmp/plivex-refund-second.log
  echo "ERROR: second concurrent refund was not rejected by cumulative amount guard"
  exit 1
fi

psql -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
DO $assert_refund_race$
DECLARE
  v_count integer;
  v_total bigint;
  v_payment_refund bigint;
  v_payment_status text;
  v_refund_status text;
BEGIN
  SELECT count(*),COALESCE(sum(amount_minor_units),0)
  INTO v_count,v_total
  FROM public.payment_refunds
  WHERE subscription_id=(SELECT id FROM public.subscriptions WHERE txnid='ORDER-REFUND-PARALLEL')
    AND status='success';
  SELECT payment_status,refund_status INTO v_payment_status,v_refund_status
  FROM public.subscriptions WHERE txnid='ORDER-REFUND-PARALLEL';
  SELECT refund_amount_minor_units INTO v_payment_refund
  FROM public.payment_logs WHERE txnid='ORDER-REFUND-PARALLEL' AND provider='cashfree';

  IF v_count <> 1 OR v_total <> 600 THEN
    RAISE EXCEPTION 'Concurrent refunds must apply exactly one 600-unit refund; rows %, total %',v_count,v_total;
  END IF;
  IF v_payment_status <> 'partially_refunded' OR v_refund_status <> 'partially_refunded' THEN
    RAISE EXCEPTION 'Subscription refund state was not reconciled: payment %, refund %',v_payment_status,v_refund_status;
  END IF;
  IF v_payment_refund <> 600 THEN
    RAISE EXCEPTION 'Payment log refund total does not match refund ledger: %',v_payment_refund;
  END IF;
END
$assert_refund_race$;
SQL

echo "PASS: concurrent Cashfree refunds were serialized; over-refund rejected and payment log reconciled"
