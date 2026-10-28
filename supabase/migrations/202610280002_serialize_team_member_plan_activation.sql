-- Serialize team membership activation with all workspace writes so concurrent
-- invite acceptances cannot exceed the plan's active-member quota.
CREATE OR REPLACE FUNCTION public.enforce_plan_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan text;
  v_limit integer;
  v_used integer;
BEGIN
  IF TG_TABLE_NAME='invoices' THEN
    IF upper(coalesce(NEW.currency,'INR')) <> 'INR'
       AND NOT public.plan_feature_allowed(NEW.workspace_id,'multi_currency') THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='PLAN_FEATURE_LOCKED|multi_currency|pro';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status::text IN ('accepted','active')
     AND OLD.status::text NOT IN ('accepted','active')
     AND NEW.user_id IS DISTINCT FROM NEW.owner_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id || ':plan-global',0));
    IF NOT public.plan_feature_allowed(NEW.workspace_id,'team') THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='PLAN_FEATURE_LOCKED|team|pro';
    END IF;
    v_plan := public.current_plan(NEW.workspace_id);
    SELECT max_count INTO v_limit FROM public.plan_limits WHERE plan=v_plan AND resource='team_members';
    SELECT count(*)::int INTO v_used FROM public.workspace_members
      WHERE workspace_id=NEW.workspace_id AND status::text IN ('accepted','active')
        AND user_id IS DISTINCT FROM owner_id AND id IS DISTINCT FROM NEW.id;
    IF v_limit IS NULL OR v_limit <= 0 OR v_used >= v_limit THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE=format('PLAN_LIMIT_REACHED|team_members|%s|%s',coalesce(v_limit,0),v_plan);
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
