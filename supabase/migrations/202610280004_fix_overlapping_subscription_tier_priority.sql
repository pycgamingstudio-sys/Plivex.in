-- Resolve overlapping active subscriptions by entitlement tier, not furthest expiry.
-- A still-active Pro subscription must not be downgraded by a later-expiring Basic order.
-- Once Pro expires, an independently active Basic subscription may still provide Basic access.
--
-- The recorded function sources have two formatting variants (including a missing
-- space after the current_plan ORDER BY comma). Match known SQL structure rather
-- than a single whitespace rendering. Unknown definitions still fail closed.
-- Emit the canonical form expected by the later remote 20261028030245 migration.
DO $$
DECLARE
  v_current_def text;
  v_access_def text;
  v_old_pattern text;
  v_final_pattern text;
  v_new text;
  v_old_count integer;
  v_final_count integer;
BEGIN
  SELECT pg_get_functiondef('public.current_plan(text)'::regprocedure)
    INTO v_current_def;

  v_old_pattern := $pattern$order by s\.expires_at desc,[[:space:]]*s\.created_at desc$pattern$;
  v_final_pattern := $pattern$order by CASE s\.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC,[[:space:]]*s\.expires_at desc,[[:space:]]*s\.created_at desc$pattern$;
  v_new := $replacement$order by CASE s.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc$replacement$;

  SELECT count(*) INTO v_old_count
  FROM regexp_matches(v_current_def, v_old_pattern, 'gi');
  SELECT count(*) INTO v_final_count
  FROM regexp_matches(v_current_def, v_final_pattern, 'gi');

  IF v_old_count = 1 AND v_final_count = 0 THEN
    v_current_def := regexp_replace(v_current_def, v_old_pattern, v_new, 'i');
  ELSIF v_old_count = 0 AND v_final_count = 1 THEN
    NULL; -- Already has the canonical Pro-first ordering.
  ELSE
    RAISE EXCEPTION 'Unexpected current_plan definition; refusing to modify it';
  END IF;

  SELECT pg_get_functiondef('public.get_access_status(text)'::regprocedure)
    INTO v_access_def;

  -- Historical get_access_status source produced by the preceding local
  -- 202610270002 migration. Flexible whitespace does not relax the predicates.
  v_old_pattern := $pattern$
select max\(s\.expires_at\) into v_expires[[:space:]]+
from public\.subscriptions s[[:space:]]+
where s\.workspace_id = p_workspace_id[[:space:]]+
and s\.status::text = 'active'[[:space:]]+
and s\.expires_at > clock_timestamp\(\)[[:space:]]+
and s\.started_at <= clock_timestamp\(\)[[:space:]]+
and s\.tier::text in \('basic','pro'\);
$pattern$;
  v_final_pattern := $pattern$
select s\.expires_at into v_expires[[:space:]]+
from public\.subscriptions s[[:space:]]+
where s\.workspace_id = p_workspace_id[[:space:]]+
and s\.status::text = 'active'[[:space:]]+
and s\.expires_at > clock_timestamp\(\)[[:space:]]+
and s\.started_at <= clock_timestamp\(\)[[:space:]]+
and s\.tier::text in \('basic','pro'\)[[:space:]]+
order by CASE s\.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC,[[:space:]]*s\.expires_at desc,[[:space:]]*s\.created_at desc[[:space:]]+
limit 1;
$pattern$;
  v_new := $replacement$select s.expires_at into v_expires
  from public.subscriptions s
  where s.workspace_id = p_workspace_id
    and s.status::text = 'active'
    and s.expires_at > clock_timestamp()
    and s.started_at <= clock_timestamp()
    and s.tier::text in ('basic','pro')
  order by CASE s.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc
  limit 1;$replacement$;

  SELECT count(*) INTO v_old_count
  FROM regexp_matches(v_access_def, v_old_pattern, 'gi');
  SELECT count(*) INTO v_final_count
  FROM regexp_matches(v_access_def, v_final_pattern, 'gi');

  IF v_old_count = 1 AND v_final_count = 0 THEN
    v_access_def := regexp_replace(v_access_def, v_old_pattern, v_new, 'i');
  ELSIF v_old_count = 0 AND v_final_count = 1 THEN
    NULL; -- Already selects the effective subscription row.
  ELSE
    RAISE EXCEPTION 'Unexpected get_access_status expiry query; refusing to modify it';
  END IF;

  -- startedAt must describe the same effective subscription as expiresAt.
  v_old_pattern := $pattern$
else[[:space:]]+\(select[[:space:]]+min\(s\.started_at\)[[:space:]]+
from public\.subscriptions s[[:space:]]+
where s\.workspace_id=p_workspace_id[[:space:]]+
and s\.status::text='active'[[:space:]]+
and s\.expires_at > clock_timestamp\(\)[[:space:]]+
and s\.tier::text in \('basic','pro'\)\)[[:space:]]+end,
$pattern$;
  v_final_pattern := $pattern$
else[[:space:]]+\(select[[:space:]]+s\.started_at[[:space:]]+
from public\.subscriptions s[[:space:]]+
where s\.workspace_id=p_workspace_id[[:space:]]+
and s\.status::text='active'[[:space:]]+
and s\.expires_at > clock_timestamp\(\)[[:space:]]+
and s\.started_at <= clock_timestamp\(\)[[:space:]]+
and s\.tier::text in \('basic','pro'\)[[:space:]]+
order by CASE s\.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC,[[:space:]]*s\.expires_at desc,[[:space:]]*s\.created_at desc[[:space:]]+
limit 1\)[[:space:]]+end,
$pattern$;
  v_new := $replacement$else (select s.started_at from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at > clock_timestamp() and s.started_at <= clock_timestamp() and s.tier::text in ('basic','pro') order by CASE s.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc limit 1) end,$replacement$;

  SELECT count(*) INTO v_old_count
  FROM regexp_matches(v_access_def, v_old_pattern, 'gi');
  SELECT count(*) INTO v_final_count
  FROM regexp_matches(v_access_def, v_final_pattern, 'gi');

  IF v_old_count = 1 AND v_final_count = 0 THEN
    v_access_def := regexp_replace(v_access_def, v_old_pattern, v_new, 'i');
  ELSIF v_old_count = 0 AND v_final_count = 1 THEN
    NULL; -- Already reports the start of the effective subscription.
  ELSE
    RAISE EXCEPTION 'Unexpected get_access_status startedAt query; refusing to modify it';
  END IF;

  -- Execute only after every expected fragment has been validated. A failed
  -- guard leaves both functions unchanged because the DO block is atomic.
  EXECUTE v_current_def;
  EXECUTE v_access_def;
END
$$;
