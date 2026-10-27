-- Enforce a workspace-wide write lock if any positive Free/paid resource quota
-- is already exceeded. This complements per-resource INSERT quota enforcement.
CREATE OR REPLACE FUNCTION public.guard_workspace_over_limit_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ws text;
  v_plan text;
  v_resource text;
  v_used bigint;
  v_limit integer;
  v_period text;
  v_cycle date;
BEGIN
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT p.workspace_id INTO v_ws FROM public.profiles p WHERE p.id = auth.uid();
  ELSE
    v_ws := COALESCE(to_jsonb(OLD)->>'workspace_id', to_jsonb(NEW)->>'workspace_id');
  END IF;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WORKSPACE_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_ws || ':plan-global', 0));
  v_plan := public.current_plan(v_ws);
  v_cycle := public.workspace_cycle_start(v_ws);

  FOR v_resource, v_limit, v_period IN
    SELECT resource, max_count, period FROM public.plan_limits WHERE plan = v_plan
  LOOP
    IF v_resource = 'invoices' THEN
      SELECT count(*) INTO v_used FROM public.invoices WHERE workspace_id=v_ws
        AND created_at >= (v_cycle::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND created_at < ((v_cycle + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kolkata');
    ELSIF v_resource = 'quotations' THEN
      SELECT count(*) INTO v_used FROM public.quotations WHERE workspace_id=v_ws
        AND created_at >= (v_cycle::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND created_at < ((v_cycle + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kolkata');
    ELSIF v_resource = 'expenses' THEN
      SELECT count(*) INTO v_used FROM public.expenses WHERE workspace_id=v_ws
        AND created_at >= (v_cycle::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND created_at < ((v_cycle + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kolkata');
    ELSIF v_resource = 'clients' THEN
      SELECT count(*) INTO v_used FROM public.clients WHERE workspace_id=v_ws;
    ELSIF v_resource = 'stock' THEN
      SELECT count(*) INTO v_used FROM public.stock WHERE workspace_id=v_ws;
    ELSIF v_resource = 'services' THEN
      SELECT count(*) INTO v_used FROM public.services WHERE workspace_id=v_ws;
    ELSIF v_resource = 'leads' THEN
      SELECT count(*) INTO v_used FROM public.leads WHERE workspace_id=v_ws;
    ELSIF v_resource = 'team_members' THEN
      SELECT count(*) INTO v_used FROM public.workspace_members
      WHERE workspace_id=v_ws AND status::text IN ('accepted','active')
        AND user_id IS DISTINCT FROM owner_id;
    ELSE
      v_used := 0;
    END IF;

    IF v_limit > 0 AND v_used >= v_limit THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE=format('PLAN_LIMIT_REACHED|%s|%s|%s', v_resource, v_limit, v_plan);
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$function$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','expenses','invoices','leads','quotations','services','stock','workspace_members'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard_plan_over_limit_write ON public.%I', t);
    EXECUTE format('CREATE TRIGGER guard_plan_over_limit_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_over_limit_write()', t);
  END LOOP;
END $$;
