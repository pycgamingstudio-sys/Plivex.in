-- AI assistant purchase-order creation: explicit confirmation + workspace-scoped idempotency.
-- This wraps the existing role-checked purchase-order RPC; it does not bypass its validation.

CREATE OR REPLACE FUNCTION public.assistant_create_purchase_order_idempotent(
  p_idempotency_key text,
  p_request_hash text,
  p_supplier_name text,
  p_items jsonb,
  p_supplier_reference text DEFAULT NULL,
  p_expected_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
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
  v_purchase_order_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF coalesce(length(trim(p_idempotency_key)), 0) < 16
     OR coalesce(length(trim(p_idempotency_key)), 0) > 160
     OR coalesce(length(trim(p_request_hash)), 0) < 16 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_REQUEST';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND';
  END IF;

  IF NOT public.has_ws_role(v_workspace_id, ARRAY['admin'::public.app_role, 'manager'::public.app_role]) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:create_purchase_order';
  END IF;

  INSERT INTO public.assistant_action_batches(workspace_id, user_id, idempotency_key, request_hash)
  VALUES (v_workspace_id, v_user_id, p_idempotency_key, p_request_hash)
  ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.assistant_action_batches
  WHERE workspace_id = v_workspace_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing.user_id <> v_user_id THEN
    RAISE EXCEPTION 'IDEMPOTENCY_OWNER_MISMATCH';
  END IF;

  IF v_existing.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH';
  END IF;

  IF v_existing.status = 'completed' OR v_existing.status = 'failed' THEN
    RETURN coalesce(v_existing.result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  END IF;

  IF v_existing.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_STATE';
  END IF;

  v_result := public.india_part4_create_purchase_order(
    p_supplier_name,
    p_items,
    p_supplier_reference,
    p_expected_date,
    p_notes
  );

  IF coalesce(v_result->>'ok', 'false') <> 'true' THEN
    UPDATE public.assistant_action_batches
    SET status = 'failed',
        result = coalesce(v_result, jsonb_build_object('ok', false, 'reason', 'purchase_order_rejected')),
        completed_at = now()
    WHERE id = v_existing.id;
    RETURN coalesce(v_result, jsonb_build_object('ok', false, 'reason', 'purchase_order_rejected'));
  END IF;

  v_purchase_order_id := (v_result->>'purchase_order_id')::uuid;

  v_result := jsonb_build_object(
    'ok', true,
    'purchase_order_id', v_purchase_order_id,
    'currency_code', v_result->>'currency_code',
    'duplicate', false
  );

  UPDATE public.assistant_action_batches
  SET status = 'completed',
      result = v_result || jsonb_build_object(
        'created', jsonb_build_array(jsonb_build_object('type', 'create_purchase_order', 'id', v_purchase_order_id))
      ),
      completed_at = now()
  WHERE id = v_existing.id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.assistant_create_purchase_order_idempotent(text, text, text, jsonb, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assistant_create_purchase_order_idempotent(text, text, text, jsonb, text, date, text) TO authenticated;


-- Workspace-scoped, idempotent warehouse creation for the AI confirmation flow.
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

  IF nullif(trim(p_name), '') IS NULL OR length(trim(p_name)) > 160
     OR length(coalesce(p_address, '')) > 500
     OR length(coalesce(p_code, '')) > 32 THEN
    RAISE EXCEPTION 'INVALID_WAREHOUSE_DETAILS';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.profiles
  WHERE id = v_user_id;

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
  WHERE workspace_id = v_workspace_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing.user_id <> v_user_id THEN
    RAISE EXCEPTION 'IDEMPOTENCY_OWNER_MISMATCH';
  END IF;

  IF v_existing.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH';
  END IF;

  IF v_existing.status = 'completed' OR v_existing.status = 'failed' THEN
    RETURN coalesce(v_existing.result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  END IF;

  IF v_existing.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_STATE';
  END IF;

  v_code := upper(regexp_replace(coalesce(nullif(trim(p_code), ''), trim(p_name)), '[^A-Z0-9]+', '-', 'g'));
  v_code := trim(both '-' from left(v_code, 32));
  IF v_code = '' THEN
    v_code := 'WH-' || upper(substr(md5(trim(p_name)), 1, 8));
  END IF;

  BEGIN
    INSERT INTO public.warehouses(workspace_id, code, name, address, is_default, is_active)
    VALUES (v_workspace_id, v_code, trim(p_name), nullif(trim(coalesce(p_address, '')), ''), false, true)
    RETURNING id INTO v_warehouse_id;
  EXCEPTION WHEN unique_violation THEN
    v_result := jsonb_build_object('ok', false, 'reason', 'warehouse_code_conflict', 'code', v_code);
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
