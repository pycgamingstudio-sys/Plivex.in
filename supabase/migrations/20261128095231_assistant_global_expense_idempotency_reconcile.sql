CREATE OR REPLACE FUNCTION public.assistant_create_global_expense_idempotent(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_values jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'global'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := p_workspace_id;
  v_existing public.assistant_action_batches%rowtype;
  v_result jsonb;
  v_expense_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF v_workspace_id IS NULL
    OR coalesce(length(trim(p_idempotency_key)), 0) < 16
    OR coalesce(length(trim(p_idempotency_key)), 0) > 160
    OR coalesce(length(trim(p_request_hash)), 0) < 16
    OR p_values IS NULL OR jsonb_typeof(p_values) <> 'object'
    OR nullif(trim(p_values->>'category'), '') IS NULL
    OR coalesce((p_values->>'amount_minor')::bigint, 0) <= 0 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_REQUEST';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM global.workspace_members
    WHERE workspace_id = v_workspace_id
      AND user_id = v_user_id
      AND status = 'active'
      AND role IN ('owner', 'admin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:create_global_expense';
  END IF;

  INSERT INTO public.assistant_action_batches(workspace_id, user_id, idempotency_key, request_hash)
  VALUES (v_workspace_id::text, v_user_id, p_idempotency_key, p_request_hash)
  ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.assistant_action_batches
  WHERE workspace_id = v_workspace_id::text
    AND idempotency_key = p_idempotency_key
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

  v_result := public.global_business_records(
    v_user_id, v_workspace_id, 'expenses', 'create', NULL, p_values, 50
  );

  IF coalesce(v_result->>'ok', 'false') <> 'true' THEN
    UPDATE public.assistant_action_batches
    SET status = 'failed', result = coalesce(v_result, jsonb_build_object('ok', false, 'reason', 'global_expense_rejected')),
        completed_at = now()
    WHERE id = v_existing.id;
    RETURN coalesce(v_result, jsonb_build_object('ok', false, 'reason', 'global_expense_rejected'));
  END IF;

  v_expense_id := (v_result->'record'->>'id')::uuid;
  IF v_expense_id IS NULL THEN
    RAISE EXCEPTION 'GLOBAL_EXPENSE_ID_MISSING';
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'expense_id', v_expense_id,
    'record', v_result->'record',
    'duplicate', false
  );

  UPDATE public.assistant_action_batches
  SET status = 'completed',
      result = v_result || jsonb_build_object(
        'created', jsonb_build_array(jsonb_build_object('type', 'create_global_expense', 'id', v_expense_id))
      ),
      completed_at = now()
  WHERE id = v_existing.id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.assistant_create_global_expense_idempotent(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assistant_create_global_expense_idempotent(uuid, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.assistant_create_global_expense_idempotent(uuid, text, text, jsonb) TO authenticated;
