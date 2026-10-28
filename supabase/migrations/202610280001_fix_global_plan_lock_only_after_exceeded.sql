-- A workspace should be locked only when its persisted usage exceeds a positive quota.
-- Reaching the exact quota must still allow normal updates/deletes; per-resource
-- INSERT triggers remain responsible for preventing creation beyond each quota.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.guard_workspace_over_limit_write()'::regprocedure)
    INTO v_def;

  IF position('IF v_limit>0 AND v_used>=v_limit THEN' IN v_def) > 0 THEN
    v_def := replace(
      v_def,
      'IF v_limit>0 AND v_used>=v_limit THEN',
      'IF v_limit>0 AND v_used>v_limit THEN'
    );
    EXECUTE v_def;
  ELSIF position('IF v_limit>0 AND v_used>v_limit THEN' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Unexpected global plan guard definition; refusing to modify it';
  END IF;
END
$$;
