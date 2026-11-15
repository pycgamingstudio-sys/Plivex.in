CREATE OR REPLACE FUNCTION public.enforce_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws text;
  v_plan text;
  v_resource text := TG_ARGV[0];
  v_period text;
  v_limit integer;
  v_used integer;
  v_month date := public.ist_month_start();
  v_dup boolean;
  v_feature text;
BEGIN
  IF auth.role()='service_role' THEN
    v_ws := NEW.workspace_id;
  ELSE
    SELECT p.workspace_id INTO v_ws FROM public.profiles p WHERE p.id=auth.uid();
    IF v_ws IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WORKSPACE_REQUIRED'; END IF;
  END IF;
  NEW.workspace_id := v_ws;
  NEW.created_at := clock_timestamp();
  IF TG_TABLE_NAME='workspace_members' THEN
    NEW.owner_id := coalesce(auth.uid(),NEW.owner_id);
    -- Owner's own membership is not a paid team seat.
    IF NEW.user_id IS NOT DISTINCT FROM NEW.owner_id THEN RETURN NEW; END IF;
  END IF;

  v_plan := public.current_plan(v_ws);
  IF v_resource='leads' THEN v_feature:='lead_pipeline';
  ELSIF v_resource='team_members' THEN v_feature:='team';
  ELSIF TG_TABLE_NAME='invoices' AND upper(coalesce(NEW.currency,'INR'))<>'INR' THEN v_feature:='multi_currency';
  END IF;
  IF v_feature IS NOT NULL AND NOT public.plan_feature_allowed(v_ws,v_feature) THEN
    INSERT INTO public.plan_rejections(workspace_id,resource,plan,reason,actor_id)
      VALUES(v_ws,v_feature,v_plan,'PLAN_FEATURE_LOCKED',auth.uid());
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE=format('PLAN_FEATURE_LOCKED|%s|pro',v_feature);
  END IF;

  SELECT period,max_count INTO v_period,v_limit FROM public.plan_limits
    WHERE plan=v_plan AND resource=v_resource;
  IF v_limit IS NULL THEN RAISE EXCEPTION 'Missing plan limit for %/%',v_plan,v_resource; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_ws||':'||v_resource,0));

  IF NEW.client_id IS NOT NULL THEN
    EXECUTE format('select exists(select 1 from public.%I where workspace_id=$1 and client_id=$2)',TG_TABLE_NAME)
      INTO v_dup USING v_ws,NEW.client_id;
    IF v_dup THEN RETURN NULL; END IF;
  END IF;

  IF v_period='month' THEN
    INSERT INTO public.usage_counters VALUES(v_ws,v_resource,v_month,0) ON CONFLICT DO NOTHING;
    SELECT used_count INTO v_used FROM public.usage_counters
      WHERE workspace_id=v_ws AND resource=v_resource AND month=v_month FOR UPDATE;
  ELSIF v_resource='team_members' THEN
    SELECT count(*)::int INTO v_used FROM public.workspace_members
      WHERE workspace_id=v_ws AND status::text IN('accepted','active') AND user_id IS DISTINCT FROM owner_id;
  ELSE
    EXECUTE format('select count(*)::int from public.%I where workspace_id=$1',TG_TABLE_NAME) INTO v_used USING v_ws;
  END IF;

  IF v_used>=v_limit THEN
    INSERT INTO public.plan_rejections(workspace_id,resource,plan,max_count,reason,actor_id)
      VALUES(v_ws,v_resource,v_plan,v_limit,'PLAN_LIMIT_REACHED',auth.uid());
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE=format('PLAN_LIMIT_REACHED|%s|%s|%s',v_resource,v_limit,v_plan);
  END IF;

  IF v_period='month' THEN
    UPDATE public.usage_counters SET used_count=used_count+1
      WHERE workspace_id=v_ws AND resource=v_resource AND month=v_month;
  END IF;
  IF TG_TABLE_NAME='invoices' THEN
    NEW.created_by:=coalesce(auth.uid(),NEW.created_by);
    NEW.number:=public.next_invoice_number(v_ws);
  END IF;
  RETURN NEW;
END;
$$;
