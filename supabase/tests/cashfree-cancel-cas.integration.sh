#!/usr/bin/env bash
set -euo pipefail
: "${PGDATABASE:?PGDATABASE must target the disposable CI database}"
psql -v ON_ERROR_STOP=1 -f supabase/tests/cashfree-cancel-cas.setup.sql
baseline="$(psql -X -A -t -v ON_ERROR_STOP=1 -c "SELECT updated_at::text FROM public.cashfree_cancel_cas_test WHERE id='sub-cas-1'")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
run_request() {
  local action="$1" desired="$2" requested="$3"
  psql -X -A -t -v ON_ERROR_STOP=1 -c "
    WITH changed AS (
      UPDATE public.cashfree_cancel_cas_test
      SET cancel_at_period_end = $desired,
          cancellation_requested_at = $requested,
          updated_at = clock_timestamp()
      WHERE id='sub-cas-1'
        AND workspace_id='workspace-cas'
        AND gateway='cashfree' AND provider='cashfree' AND status='active'
        AND started_at <= clock_timestamp()
        AND expires_at > clock_timestamp()
        AND cancel_at_period_end = false
        AND updated_at = '$baseline'::timestamptz
      RETURNING id
    )
    SELECT CASE WHEN count(*)=1 THEN 200 ELSE 409 END FROM changed
  " > "$tmp/$action"
}
run_request cancel true "'2026-11-14T00:00:00Z'" &
p1=$!
run_request resume false NULL &
p2=$!
wait "$p1"
wait "$p2"
cancel_status="$(cat "$tmp/cancel")"
resume_status="$(cat "$tmp/resume")"
if ! { [[ "$cancel_status" == "200" && "$resume_status" == "409" ]] || [[ "$cancel_status" == "409" && "$resume_status" == "200" ]]; }; then
  echo "FAIL: expected exactly one success and one stale conflict; cancel=$cancel_status resume=$resume_status"
  exit 1
fi
final="$(psql -X -A -t -F '|' -v ON_ERROR_STOP=1 -c "SELECT cancel_at_period_end::text, cancellation_requested_at IS NOT NULL FROM public.cashfree_cancel_cas_test WHERE id='sub-cas-1'")"
if [[ "$cancel_status" == "200" && "$final" != "true|true" ]]; then
  echo "FAIL: cancel API success did not match final PostgreSQL state: $final"
  exit 1
fi
if [[ "$resume_status" == "200" && "$final" != "false|false" ]]; then
  echo "FAIL: resume API success did not match final PostgreSQL state: $final"
  exit 1
fi
echo "PASS: real PostgreSQL concurrent endpoint-CAS outcome; cancel=$cancel_status resume=$resume_status final=$final"
# Expired-window protection: an expired subscription cannot be changed by a stale request.
psql -v ON_ERROR_STOP=1 <<'SQL'
UPDATE public.cashfree_cancel_cas_test SET expires_at=clock_timestamp()-interval '1 second'
WHERE id='sub-cas-1';
DO $expired$
DECLARE v_count integer;
BEGIN
  UPDATE public.cashfree_cancel_cas_test
  SET cancel_at_period_end=true, updated_at=clock_timestamp()
  WHERE id='sub-cas-1' AND workspace_id='workspace-cas'
    AND gateway='cashfree' AND provider='cashfree' AND status='active'
    AND started_at <= clock_timestamp() AND expires_at > clock_timestamp();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Expired subscription accepted a stale cancellation update'; END IF;
END
$expired$;
SQL
echo "PASS: expired subscription rejected by active-window predicate"

# Future-start guard: a not-yet-started subscription must not accept cancellation.
psql -v ON_ERROR_STOP=1 <<'SQL'
UPDATE public.cashfree_cancel_cas_test
SET expires_at=clock_timestamp()+interval '30 days',
    started_at=clock_timestamp()+interval '1 day',
    cancel_at_period_end=false,
    updated_at=clock_timestamp()
WHERE id='sub-cas-1';
DO $future_started$
DECLARE v_count integer;
BEGIN
  UPDATE public.cashfree_cancel_cas_test
  SET cancel_at_period_end=true, updated_at=clock_timestamp()
  WHERE id='sub-cas-1' AND workspace_id='workspace-cas'
    AND gateway='cashfree' AND provider='cashfree' AND status='active'
    AND started_at <= clock_timestamp() AND expires_at > clock_timestamp();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Future-start subscription accepted a cancellation update'; END IF;
END
$future_started$;
SQL
echo "PASS: future-start subscription rejected by active-window predicate"
