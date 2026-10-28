-- Allow users to recover after a plan downgrade leaves saved records over quota.
-- RLS and dedicated update guards still enforce ownership and feature rules.
-- The global quota guard is only needed for INSERTs: UPDATE/DELETE do not add rows,
-- and DELETE must remain possible so users can remove records above the new limit.
DO $$
DECLARE
  v_def text;
  v_anchor text := $anchor$  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF auth.uid() IS NOT NULL THEN$anchor$;
  v_replacement text := $replacement$  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Existing records must remain manageable after downgrade; quota enforcement
  -- on INSERT and the dedicated feature/team update guards remain in place.
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF auth.uid() IS NOT NULL THEN$replacement$;
BEGIN
  SELECT pg_get_functiondef('public.guard_workspace_over_limit_write()'::regprocedure)
    INTO v_def;

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'Unexpected guard_workspace_over_limit_write definition; refusing to modify it';
  END IF;

  EXECUTE replace(v_def, v_anchor, v_replacement);
END
$$;
