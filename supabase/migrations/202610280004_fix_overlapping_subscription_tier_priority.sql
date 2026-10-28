-- Resolve overlapping active subscriptions by entitlement tier, not furthest expiry.
-- A still-active Pro subscription must not be downgraded by a later-expiring Basic order.
-- Once Pro expires, an independently active Basic subscription may still provide Basic access.
DO $$
DECLARE
  v_def text;
  v_anchor text;
BEGIN
  SELECT pg_get_functiondef('public.current_plan(text)'::regprocedure) INTO v_def;
  v_anchor := 'order by s.expires_at desc, s.created_at desc';
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'Unexpected current_plan definition; refusing to modify it';
  END IF;
  v_def := replace(
    v_def,
    v_anchor,
    'order by case s.tier::text when ''pro'' then 2 when ''basic'' then 1 else 0 end desc, s.expires_at desc, s.created_at desc'
  );
  EXECUTE v_def;

  SELECT pg_get_functiondef('public.get_access_status(text)'::regprocedure) INTO v_def;
  v_anchor := $anchor$select max(s.expires_at) into v_expires
  from public.subscriptions s
  where s.workspace_id = p_workspace_id
    and s.status::text = 'active'
    and s.expires_at > clock_timestamp()
    and s.started_at <= clock_timestamp()
    and s.tier::text in ('basic','pro');$anchor$;
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'Unexpected get_access_status expiry query; refusing to modify it';
  END IF;
  v_def := replace(
    v_def,
    v_anchor,
    $replacement$select max(s.expires_at) into v_expires
  from public.subscriptions s
  where s.workspace_id = p_workspace_id
    and s.status::text = 'active'
    and s.expires_at > clock_timestamp()
    and s.started_at <= clock_timestamp()
    and s.tier::text = v_plan;$replacement$
  );

  v_anchor := $anchor$and s.tier::text in ('basic','pro')) end$anchor$;
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'Unexpected get_access_status startedAt query; refusing to modify it';
  END IF;
  v_def := replace(v_def, v_anchor, 'and s.tier::text = v_plan) end');
  EXECUTE v_def;
END
$$;
