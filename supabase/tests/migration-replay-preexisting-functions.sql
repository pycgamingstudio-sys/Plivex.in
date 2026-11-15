-- Baseline object recovered through a read-only pg_get_functiondef query.
-- Production migration 20261025092518 revokes privileges from this pre-existing
-- function; its CREATE statement is not present in the 47-row migration ledger.
-- This exact definition is installed only in disposable replay databases.
CREATE OR REPLACE FUNCTION public.workspace_cycle_start(
  p_workspace_id text,
  p_at timestamp with time zone DEFAULT clock_timestamp()
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_anchor timestamptz;
  v_local_anchor timestamp;
  v_local_now timestamp;
  v_months integer;
  v_candidate timestamp;
BEGIN
  SELECT s.started_at INTO v_anchor
  FROM public.subscriptions s
  WHERE s.workspace_id = p_workspace_id
    AND s.status::text = 'active'
    AND s.expires_at > p_at
    AND s.started_at <= p_at
    AND s.tier::text IN ('basic','pro')
  ORDER BY s.expires_at DESC, s.created_at DESC
  LIMIT 1;

  IF v_anchor IS NULL THEN
    SELECT p.created_at INTO v_anchor
    FROM public.profiles p
    WHERE p.workspace_id = p_workspace_id
    ORDER BY p.created_at ASC
    LIMIT 1;
  END IF;

  IF v_anchor IS NULL THEN
    RETURN public.ist_month_start(p_at);
  END IF;

  v_local_anchor := v_anchor AT TIME ZONE 'Asia/Kolkata';
  v_local_now := p_at AT TIME ZONE 'Asia/Kolkata';
  v_months := (extract(year FROM v_local_now)::int - extract(year FROM v_local_anchor)::int) * 12
            + (extract(month FROM v_local_now)::int - extract(month FROM v_local_anchor)::int);
  v_candidate := v_local_anchor + make_interval(months => v_months);

  IF v_candidate > v_local_now THEN
    v_months := v_months - 1;
    v_candidate := v_local_anchor + make_interval(months => v_months);
  END IF;

  RETURN v_candidate::date;
END
$function$;

ALTER FUNCTION public.workspace_cycle_start(text, timestamptz) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.workspace_cycle_start(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_cycle_start(text, timestamptz) TO service_role;
