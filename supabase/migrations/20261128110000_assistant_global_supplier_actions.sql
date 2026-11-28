-- Nova Global supplier create/list operations: authenticated, workspace-scoped and idempotent.
CREATE OR REPLACE FUNCTION public.assistant_create_global_supplier_idempotent(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_values jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'global'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing public.assistant_action_batches%rowtype;
  v_result jsonb;
  v_supplier_id uuid;
  v_name text := nullif(btrim(p_values->>'name'), '');
  v_email text := nullif(lower(btrim(p_values->>'email')), '');
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_workspace_id IS NULL
    OR coalesce(length(trim(p_idempotency_key)), 0) < 16
    OR coalesce(length(trim(p_idempotency_key)), 0) > 160
    OR coalesce(length(trim(p_request_hash)), 0) < 16
    OR p_values IS NULL OR jsonb_typeof(p_values) <> 'object'
    OR v_name IS NULL OR length(v_name) > 200
    OR (v_email IS NOT NULL AND v_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    OR length(coalesce(p_values->>'phone','')) > 40
    OR length(coalesce(p_values->>'tax_registration_number','')) > 80 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_REQUEST';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM global.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = v_user_id
      AND status = 'active' AND role IN ('owner','admin','manager')
  ) THEN RAISE EXCEPTION 'PERMISSION_DENIED:create_global_supplier'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text || ':global-supplier:' || lower(regexp_replace(v_name, '\s+', ' ', 'g')), 0
  ));

  INSERT INTO public.assistant_action_batches(workspace_id,user_id,idempotency_key,request_hash)
  VALUES (p_workspace_id::text,v_user_id,p_idempotency_key,p_request_hash)
  ON CONFLICT (workspace_id,idempotency_key) DO NOTHING;

  SELECT * INTO v_existing FROM public.assistant_action_batches
  WHERE workspace_id=p_workspace_id::text AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_existing.user_id <> v_user_id THEN RAISE EXCEPTION 'IDEMPOTENCY_OWNER_MISMATCH'; END IF;
  IF v_existing.request_hash <> p_request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH'; END IF;
  IF v_existing.status IN ('completed','failed') THEN
    RETURN coalesce(v_existing.result,'{}'::jsonb) || jsonb_build_object('duplicate',true);
  END IF;
  IF v_existing.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_STATE'; END IF;

  IF EXISTS (
    SELECT 1 FROM global.suppliers
    WHERE workspace_id=p_workspace_id
      AND lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) =
          lower(regexp_replace(v_name, '\s+', ' ', 'g'))
  ) THEN
    v_result := jsonb_build_object('ok',false,'reason','duplicate_supplier');
    UPDATE public.assistant_action_batches SET status='failed',result=v_result,completed_at=now()
    WHERE id=v_existing.id;
    RETURN v_result;
  END IF;

  INSERT INTO global.suppliers(workspace_id,name,email,phone,tax_registration_number,created_by)
  VALUES (p_workspace_id,v_name,v_email,nullif(btrim(p_values->>'phone'), ''),
    nullif(btrim(p_values->>'tax_registration_number'), ''),v_user_id)
  RETURNING id INTO v_supplier_id;

  INSERT INTO global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  VALUES (p_workspace_id,v_user_id,'assistant.create_supplier','supplier',v_supplier_id::text,
    jsonb_build_object('source','assistant-confirm','idempotency_key',p_idempotency_key));

  SELECT jsonb_build_object('id',s.id,'name',s.name,'email',s.email,'phone',s.phone,
    'tax_registration_number',s.tax_registration_number,'created_at',s.created_at)
  INTO v_result FROM global.suppliers s
  WHERE s.id=v_supplier_id AND s.workspace_id=p_workspace_id;

  v_result := jsonb_build_object('ok',true,'supplier_id',v_supplier_id,'record',v_result,'duplicate',false);
  UPDATE public.assistant_action_batches
  SET status='completed',
      result=v_result || jsonb_build_object('created',jsonb_build_array(
        jsonb_build_object('type','create_global_supplier','id',v_supplier_id))),
      completed_at=now()
  WHERE id=v_existing.id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assistant_list_global_suppliers(
  p_workspace_id uuid,
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','global'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_records jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM global.workspace_members
    WHERE workspace_id=p_workspace_id AND user_id=v_user_id AND status='active'
  ) THEN RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC),'[]'::jsonb)
  INTO v_records FROM (
    SELECT id,name,email,phone,tax_registration_number,created_at
    FROM global.suppliers WHERE workspace_id=p_workspace_id
    ORDER BY created_at DESC LIMIT greatest(1,least(coalesce(p_limit,100),100))
  ) s;
  RETURN jsonb_build_object('ok',true,'records',v_records,'limit',greatest(1,least(coalesce(p_limit,100),100)));
END;
$function$;

REVOKE ALL ON FUNCTION public.assistant_create_global_supplier_idempotent(uuid,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_create_global_supplier_idempotent(uuid,text,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.assistant_list_global_suppliers(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_list_global_suppliers(uuid,integer) TO authenticated;
