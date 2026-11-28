CREATE OR REPLACE FUNCTION public.global_list_invoice_reconciliation(
  p_user_id uuid,
  p_workspace_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'global'
AS $function$
DECLARE
  v_role text;
  v_country_code text;
  v_records jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
BEGIN
  IF p_user_id IS NULL OR p_workspace_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  END IF;

  SELECT role INTO v_role
  FROM global.workspace_members
  WHERE workspace_id = p_workspace_id
    AND user_id = p_user_id
    AND status = 'active'
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'access_denied');
  END IF;

  SELECT country_code INTO v_country_code
  FROM global.workspaces
  WHERE id = p_workspace_id;

  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.invoice_id), '[]'::jsonb)
  INTO v_records
  FROM (
    SELECT reconciliation.*, client.name AS client_name
    FROM global.invoice_reconciliation AS reconciliation
    JOIN global.invoices AS invoice
      ON invoice.id = reconciliation.invoice_id
      AND invoice.workspace_id = reconciliation.workspace_id
    LEFT JOIN global.clients AS client
      ON client.id = invoice.client_id
      AND client.workspace_id = invoice.workspace_id
    WHERE reconciliation.workspace_id = p_workspace_id
    ORDER BY reconciliation.invoice_id DESC
    LIMIT v_limit
  ) AS t;

  RETURN jsonb_build_object(
    'ok', true,
    'country_code', v_country_code,
    'records', v_records
  );
END;
$function$;
