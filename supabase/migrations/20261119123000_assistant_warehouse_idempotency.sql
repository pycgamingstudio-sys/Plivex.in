-- Idempotent, workspace-scoped warehouse creation for Plivex AI.
-- Uses the authenticated user's workspace and existing admin/manager role policy.

CREATE OR REPLACE FUNCTION public.assistant_create_warehouse_idempotent(
  p_idempotency_key text,
  p_request_hash text,
  p_name text,
  p_code text DEFAULT NULL,
  p_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_workspace_id text;
  v_existing public.assistant_action_batches%rowtype;
  v_result jsonb;
  v_warehouse_id uuid;
  v_code text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF coalesce(length(trim(p_idempotency_key)), 0) < 16
     OR coalesce(length(trim(p_idempotency_key)), 0) > 160
     OR coalesce(length(trim(p_request_hash)), 0) < 16 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_REQUEST';
  END IF;
  IF nullif(trim(p_name), '') IS NULL OR length(p_name) > 160
     OR (nullif(trim(p_code), '') IS NOT NULL
       AND trim(p_code) !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,31}$')
     OR length(coalesce(p_address, '')) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_warehouse');
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.profiles WHERE id = v_user_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND';
  END IF;
  IF NOT public.has_ws_role(v_workspace_id, ARRAY['admin'::public.app_role, 'manager'::public.app_role]) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:create_warehouse';
  END IF;

  INSERT INTO public.assistant_action_batches(workspace_id, user_id, idempotency_key, request_hash)
  VALUES (v_workspace_id, v_user_id, p_idempotency_key, p_request_hash)
  ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.assistant_action_batches
  WHERE workspace_id = v_workspace_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing.user_id <> v_user_id THEN
    RAISE EXCEPTION 'IDEMPOTENCY_OWNER_MISMATCH';
  END IF;
  IF v_existing.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH';
  END IF;
  IF v_existing.status IN ('completed', 'failed') THEN
    RETURN coalesce(v_existing.result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  END IF;
  IF v_existing.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_STATE';
  END IF;

  v_code := upper(coalesce(nullif(trim(p_code), ''), 'WH-' || substr(gen_random_uuid()::text, 1, 8)));
  IF EXISTS (
    SELECT 1 FROM public.warehouses
    WHERE workspace_id = v_workspace_id AND lower(code) = lower(v_code)
  ) THEN
    v_result := jsonb_build_object('ok', false, 'reason', 'warehouse_code_conflict');
    UPDATE public.assistant_action_batches
    SET status = 'failed', result = v_result, completed_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END IF;

  BEGIN
    INSERT INTO public.warehouses(workspace_id, code, name, address, is_default, is_active)
    VALUES (v_workspace_id, v_code, trim(p_name), nullif(trim(p_address), ''), false, true)
    RETURNING id INTO v_warehouse_id;
  EXCEPTION WHEN unique_violation THEN
    v_result := jsonb_build_object('ok', false, 'reason', 'warehouse_code_conflict');
    UPDATE public.assistant_action_batches
    SET status = 'failed', result = v_result, completed_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END;

  v_result := jsonb_build_object(
    'ok', true,
    'warehouse_id', v_warehouse_id,
    'code', v_code,
    'duplicate', false
  );
  UPDATE public.assistant_action_batches
  SET status = 'completed',
      result = v_result || jsonb_build_object(
        'created', jsonb_build_array(jsonb_build_object('type', 'create_warehouse', 'id', v_warehouse_id))
      ),
      completed_at = now()
  WHERE id = v_existing.id;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.assistant_create_warehouse_idempotent(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assistant_create_warehouse_idempotent(text, text, text, text, text) TO authenticated;
