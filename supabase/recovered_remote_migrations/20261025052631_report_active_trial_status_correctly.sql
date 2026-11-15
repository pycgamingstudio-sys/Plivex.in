CREATE OR REPLACE FUNCTION public.get_access_status(p_workspace_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_plan text;
  v_expires timestamptz;
  v_trial_expires timestamptz;
  v_trial_active boolean := false;
  v_limits jsonb;
  v_usage jsonb;
  v_features jsonb;
  v_reset timestamptz;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.workspace_id = p_workspace_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WORKSPACE_ACCESS_DENIED';
  END IF;

  v_plan := public.current_plan(p_workspace_id);

  SELECT max(s.expires_at) INTO v_expires
  FROM public.subscriptions s
  WHERE s.workspace_id=p_workspace_id
    AND s.status::text='active'
    AND s.expires_at > clock_timestamp()
    AND s.started_at <= clock_timestamp();

  IF v_expires IS NULL THEN
    SELECT max(p.trial_expires_at) INTO v_trial_expires
    FROM public.profiles p
    WHERE p.workspace_id=p_workspace_id
      AND p.trial_expires_at > clock_timestamp();
    IF v_trial_expires IS NOT NULL THEN
      v_expires := v_trial_expires;
      v_trial_active := true;
    END IF;
  END IF;

  SELECT coalesce(jsonb_object_agg(resource,max_count),'{}'::jsonb)
    INTO v_limits FROM public.plan_limits WHERE plan=v_plan;

  SELECT jsonb_object_agg(pl.resource,
    CASE
      WHEN pl.period='month' THEN coalesce(uc.used_count,0)
      WHEN pl.resource='clients' THEN (SELECT count(*) FROM public.clients c WHERE c.workspace_id=p_workspace_id)
      WHEN pl.resource='stock' THEN (SELECT count(*) FROM public.stock s WHERE s.workspace_id=p_workspace_id)
      WHEN pl.resource='leads' THEN (SELECT count(*) FROM public.leads l WHERE l.workspace_id=p_workspace_id)
      WHEN pl.resource='services' THEN (SELECT count(*) FROM public.services s WHERE s.workspace_id=p_workspace_id)
      WHEN pl.resource='team_members' THEN (SELECT count(*) FROM public.workspace_members wm WHERE wm.workspace_id=p_workspace_id AND wm.status::text IN ('accepted','active') AND wm.user_id IS DISTINCT FROM wm.owner_id)
      ELSE 0
    END)
    INTO v_usage
  FROM public.plan_limits pl
  LEFT JOIN public.usage_counters uc
    ON uc.workspace_id=p_workspace_id AND uc.resource=pl.resource AND uc.month=public.ist_month_start()
  WHERE pl.plan=v_plan;

  SELECT coalesce(jsonb_object_agg(feature,allowed),'{}'::jsonb)
    INTO v_features FROM public.plan_features WHERE plan=v_plan;

  v_reset := (public.ist_month_start()+interval '1 month')::timestamp AT TIME ZONE 'Asia/Kolkata';

  RETURN jsonb_build_object(
    'plan',v_plan,
    'planName',CASE v_plan WHEN 'free' THEN 'Free' WHEN 'basic' THEN 'Basic' ELSE 'Pro' END,
    'expiresAt',v_expires,
    'limits',v_limits,
    'usage',coalesce(v_usage,'{}'::jsonb),
    'resetsAt',v_reset,
    'features',coalesce(v_features,'{}'::jsonb),
    'trialActive',v_trial_active
  );
END;
$function$;
