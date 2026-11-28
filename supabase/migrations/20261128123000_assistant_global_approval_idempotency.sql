-- Idempotent Main Workspace approval request wrapper around the existing audited approval engine.
CREATE OR REPLACE FUNCTION public.assistant_create_global_approval_request_idempotent(
  p_user_id uuid,
  p_workspace_id uuid,
  p_idempotency_key uuid,
  p_request_hash text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','global'
AS $function$
DECLARE
  v_existing public.assistant_action_batches%rowtype;
  v_result jsonb;
BEGIN
  IF p_user_id IS NULL OR p_workspace_id IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_idempotency_key IS NULL OR coalesce(length(trim(p_request_hash)),0) < 16
    OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_REQUEST';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM global.workspace_members
    WHERE workspace_id=p_workspace_id AND user_id=p_user_id AND status='active'
  ) THEN RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':approval:' || p_idempotency_key::text,0));
  INSERT INTO public.assistant_action_batches(workspace_id,user_id,idempotency_key,request_hash)
  VALUES (p_workspace_id::text,p_user_id,p_idempotency_key::text,p_request_hash)
  ON CONFLICT (workspace_id,idempotency_key) DO NOTHING;

  SELECT * INTO v_existing FROM public.assistant_action_batches
  WHERE workspace_id=p_workspace_id::text AND idempotency_key=p_idempotency_key::text FOR UPDATE;
  IF v_existing.user_id <> p_user_id THEN RAISE EXCEPTION 'IDEMPOTENCY_OWNER_MISMATCH'; END IF;
  IF v_existing.request_hash <> p_request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH'; END IF;
  IF v_existing.status IN ('completed','failed') THEN
    RETURN coalesce(v_existing.result,'{}'::jsonb) || jsonb_build_object('duplicate',true);
  END IF;
  IF v_existing.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_STATE'; END IF;

  v_result := public.global_approval_request_v2(p_user_id,p_workspace_id,p_payload);
  IF coalesce(v_result->>'ok','false') <> 'true' THEN
    UPDATE public.assistant_action_batches SET status='failed',result=v_result,completed_at=now()
    WHERE id=v_existing.id;
    RETURN v_result;
  END IF;
  v_result := v_result || jsonb_build_object('duplicate',false);
  UPDATE public.assistant_action_batches
  SET status='completed',
      result=v_result || jsonb_build_object('created',jsonb_build_array(
        jsonb_build_object('type','request_global_approval','id',v_result->>'requestId'))),
      completed_at=now()
  WHERE id=v_existing.id;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.assistant_create_global_approval_request_idempotent(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assistant_create_global_approval_request_idempotent(uuid,uuid,uuid,text,jsonb) TO authenticated;
