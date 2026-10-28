-- Make overlapping subscriptions deterministic: an active Pro plan must not be
-- shadowed by a longer-running Basic plan. Once Pro expires, an active Basic plan
-- can become effective. Report the expiry/start date of the effective subscription.
DO $$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.current_plan(text)'::regprocedure) INTO v_def;
  v_old := '  order by s.expires_at desc, s.created_at desc';
  v_new := '  order by CASE s.tier::text WHEN ''pro'' THEN 2 WHEN ''basic'' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc';
  IF position(v_old IN v_def) = 0 THEN
    IF position(v_new IN v_def) = 0 THEN RAISE EXCEPTION 'Unexpected current_plan ordering; refusing to modify'; END IF;
  ELSE
    EXECUTE replace(v_def, v_old, v_new);
  END IF;

  SELECT pg_get_functiondef('public.get_access_status(text)'::regprocedure) INTO v_def;
  v_old := $old$  select max(s.expires_at) into v_expires
  from public.subscriptions s
  where s.workspace_id = p_workspace_id
    and s.status::text = 'active'
    and s.expires_at > clock_timestamp()
    and s.started_at <= clock_timestamp()
    and s.tier::text in ('basic','pro');$old$;
  v_new := $new$  select s.expires_at into v_expires
  from public.subscriptions s
  where s.workspace_id = p_workspace_id
    and s.status::text = 'active'
    and s.expires_at > clock_timestamp()
    and s.started_at <= clock_timestamp()
    and s.tier::text in ('basic','pro')
  order by CASE s.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc
  limit 1;$new$;
  IF position(v_old IN v_def) = 0 THEN
    IF position(v_new IN v_def) = 0 THEN RAISE EXCEPTION 'Unexpected access-status expiry query; refusing to modify'; END IF;
  ELSE
    v_def := replace(v_def, v_old, v_new);
  END IF;

  v_old := $old$else (select min(s.started_at) from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at > clock_timestamp() and s.tier::text in ('basic','pro')) end,$old$;
  v_new := $new$else (select s.started_at from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at > clock_timestamp() and s.started_at <= clock_timestamp() and s.tier::text in ('basic','pro') order by CASE s.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc limit 1) end,$new$;
  IF position(v_old IN v_def) = 0 THEN
    IF position(v_new IN v_def) = 0 THEN RAISE EXCEPTION 'Unexpected access-status start-date query; refusing to modify'; END IF;
  ELSE
    v_def := replace(v_def, v_old, v_new);
  END IF;
  EXECUTE v_def;
END
$$;