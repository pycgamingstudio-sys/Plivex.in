-- Converge subscription priority functions after the duplicate 202610280004
-- migration version is resolved.
--
-- The duplicate version may have been applied with either historical file body.
-- Supabase records the version timestamp, not which duplicate file contents ran.
-- Accept both known post-004 definitions and fail closed on any unknown drift.

DO $$
DECLARE
  v_def text;
  v_old text;
  v_final text;
BEGIN
  -- current_plan: both historical 004 files intend Pro > Basic > other tiers,
  -- then latest expiry/creation time. Normalize the first file's lowercase
  -- expression to the second file's canonical expression; accept already-final.
  SELECT pg_get_functiondef('public.current_plan(text)'::regprocedure) INTO v_def;

  v_old := 'order by case s.tier::text when ''pro'' then 2 when ''basic'' then 1 else 0 end desc, s.expires_at desc, s.created_at desc';
  v_final := 'order by CASE s.tier::text WHEN ''pro'' THEN 2 WHEN ''basic'' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc';

  IF position(v_final IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'Unexpected current_plan ordering after 202610280004; refusing to modify';
    END IF;
    v_def := replace(v_def, v_old, v_final);
    EXECUTE v_def;
  END IF;

  -- get_access_status expiry: normalize the first historical 004 result
  -- (max expiry for v_plan) to the effective subscription row selected by
  -- tier priority, expiry, and creation time. Accept the second file's result.
  SELECT pg_get_functiondef('public.get_access_status(text)'::regprocedure) INTO v_def;

  -- pg_get_functiondef indents PL/pgSQL body lines with tabs; remove those
  -- formatting-only tabs so known SQL fragments match independent of indentation.
  v_def := replace(v_def, E'\t', '');

  v_old := $old$
 select max(s.expires_at) into v_expires
   from public.subscriptions s
   where s.workspace_id = p_workspace_id
     and s.status::text = 'active'
     and s.expires_at > clock_timestamp()
     and s.started_at <= clock_timestamp()
     and s.tier::text = v_plan;$old$;

  v_final := $final$
 select s.expires_at into v_expires
   from public.subscriptions s
   where s.workspace_id = p_workspace_id
     and s.status::text = 'active'
     and s.expires_at > clock_timestamp()
     and s.started_at <= clock_timestamp()
     and s.tier::text in ('basic','pro')
   order by CASE s.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc
   limit 1;$final$;

  -- PostgreSQL adds formatter indentation to pg_get_functiondef output.
  -- Strip line-leading whitespace from the rendered definition and both
  -- known query fragments before exact matching; SQL indentation is cosmetic.
  v_def := regexp_replace(v_def, E'\\n[[:blank:]]+', E'\\n', 'g');
  v_old := regexp_replace(v_old, E'\\n[[:blank:]]+', E'\\n', 'g');
  v_final := regexp_replace(v_final, E'\\n[[:blank:]]+', E'\\n', 'g');

  IF position(v_final IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'Unexpected get_access_status expiry query after 202610280004; refusing to modify';
    END IF;
    v_def := replace(v_def, v_old, v_final);
  END IF;

  -- startedAt must describe the same effective subscription as expiresAt.
  v_old := $old$
else (select min(s.started_at) from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at > clock_timestamp() and s.tier::text = v_plan) end,$old$;

  v_final := $final$
else (select s.started_at from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at > clock_timestamp() and s.started_at <= clock_timestamp() and s.tier::text in ('basic','pro') order by CASE s.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc limit 1) end,$final$;

  IF position(v_final IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'Unexpected get_access_status startedAt query after 202610280004; refusing to modify';
    END IF;
    v_def := replace(v_def, v_old, v_final);
  END IF;

  EXECUTE v_def;
END
$$;
