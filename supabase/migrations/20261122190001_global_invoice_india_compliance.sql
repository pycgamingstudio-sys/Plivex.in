-- Store manually entered IRN / E-Way Bill references as supplemental invoice metadata.
-- This does not submit or validate documents with GSTN/IRP.

CREATE OR REPLACE FUNCTION public.global_save_invoice_india_compliance(
  p_user_id uuid,
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_compliance jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_role text;
  v_country text;
  v_status text;
  v_compliance jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR p_workspace_id IS NULL OR p_invoice_id IS NULL
     OR p_compliance IS NULL OR jsonb_typeof(p_compliance) <> 'object' THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_request');
  END IF;

  SELECT role INTO v_role
  FROM global.workspace_members
  WHERE workspace_id = p_workspace_id
    AND user_id = p_user_id
    AND status = 'active';

  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','accountant') THEN
    RETURN jsonb_build_object('ok',false,'reason','access_denied');
  END IF;

  SELECT upper(country_code) INTO v_country
  FROM global.workspaces
  WHERE id = p_workspace_id;

  IF v_country IS DISTINCT FROM 'IN' THEN
    RETURN jsonb_build_object('ok',false,'reason','wrong_country');
  END IF;

  SELECT status INTO v_status
  FROM global.invoices
  WHERE workspace_id = p_workspace_id AND id = p_invoice_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','invoice_not_found');
  END IF;
  IF v_status NOT IN ('issued','partially_paid','paid','overdue') THEN
    RETURN jsonb_build_object('ok',false,'reason','invoice_not_issued');
  END IF;

  IF COALESCE(p_compliance->>'irn','') <> '' AND p_compliance->>'irn' !~* '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_irn');
  END IF;
  IF COALESCE(p_compliance->>'ack_number','') <> '' AND p_compliance->>'ack_number' !~ '^[0-9]{15}$' THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_ack_number');
  END IF;
  IF COALESCE(p_compliance->>'eway_bill_number','') <> '' AND p_compliance->>'eway_bill_number' !~ '^[0-9]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_eway_bill_number');
  END IF;

  v_compliance := p_compliance || jsonb_build_object('saved_at',v_now);
  UPDATE global.invoices
  SET invoice_snapshot = jsonb_set(COALESCE(invoice_snapshot,'{}'::jsonb),'{india_compliance}',v_compliance,true),
      updated_at = v_now
  WHERE workspace_id = p_workspace_id AND id = p_invoice_id;

  INSERT INTO global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,request_id,metadata,occurred_at)
  VALUES (
    p_workspace_id,p_user_id,'invoice.india_compliance_refs_saved','invoice',p_invoice_id::text,
    gen_random_uuid()::text,
    jsonb_build_object(
      'has_irn',COALESCE(p_compliance->>'irn','') <> '',
      'has_ack_number',COALESCE(p_compliance->>'ack_number','') <> '',
      'has_eway_bill_number',COALESCE(p_compliance->>'eway_bill_number','') <> ''
    ),v_now
  );

  RETURN jsonb_build_object('ok',true,'invoice_id',p_invoice_id,'saved_at',v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.global_save_invoice_india_compliance(uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.global_save_invoice_india_compliance(uuid,uuid,uuid,jsonb)
  TO service_role;
