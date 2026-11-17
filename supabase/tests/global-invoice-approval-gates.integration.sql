\set ON_ERROR_STOP on
SET ROLE service_role;
DO $part9_invoice_approval$
DECLARE
  result jsonb;
  request_id uuid;
  invoice_id uuid;
  payment_id uuid;
  ws uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  requester uuid := '88888888-8888-4888-8888-888888888888';
  approver uuid := '66666666-6666-4666-8666-666666666666';
  blocked boolean := false;
  invoice_key uuid := '99999999-9999-4999-8999-999999999911';
  payment_key uuid := '99999999-9999-4999-8999-999999999912';
  workspace_currency text;
BEGIN
  SELECT currency_code INTO workspace_currency FROM global.workspaces WHERE id=ws;
  result := public.global_set_approval_policy(approver,ws,'invoice.issue',true,1000,array['owner','admin']::text[],true);
  IF result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Admin could not set invoice issue policy: %',result; END IF;
  result := public.global_set_approval_policy(approver,ws,'invoice.payment.record',true,1000,array['owner','admin']::text[],true);
  IF result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Admin could not set invoice payment policy: %',result; END IF;

  INSERT INTO global.invoices(workspace_id,invoice_number,status,currency_code,issue_date,total_minor,created_by,creation_idempotency_key)
  VALUES (ws,'PART9-APPROVAL-'||replace(gen_random_uuid()::text,'-',''),'draft',workspace_currency,current_date,2500,requester,invoice_key)
  RETURNING id INTO invoice_id;

  BEGIN
    UPDATE global.invoices SET status='issued' WHERE id=invoice_id AND workspace_id=ws;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    blocked := position('approval_required' in SQLERRM)>0;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Invoice issue bypassed approval gate'; END IF;

  result := public.global_enterprise_action(requester,ws,'approval.request',
    jsonb_build_object('actionType','invoice.issue','resourceType','invoice','resourceId',invoice_id::text,
      'payload',jsonb_build_object('amountMinor','2500','currencyCode',workspace_currency,'eventDate',to_char(current_date,'YYYY-MM-DD'))));
  IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'Invoice issue approval request failed: %',result; END IF;
  request_id := (result->>'requestId')::uuid;
  result := public.global_enterprise_action(approver,ws,'approval.decide',
    jsonb_build_object('requestId',request_id::text,'decision','approved','note','Invoice issue approved'));
  IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'Invoice issue approval decision failed: %',result; END IF;
  UPDATE global.invoices SET status='issued' WHERE id=invoice_id AND workspace_id=ws;
  IF NOT EXISTS(SELECT 1 FROM global.invoices WHERE id=invoice_id AND status='issued') THEN
    RAISE EXCEPTION 'Approved invoice was not issued';
  END IF;

  blocked := false;
  BEGIN
    INSERT INTO global.invoice_payments(workspace_id,invoice_id,amount_minor,currency_code,payment_date,recorded_by,idempotency_key)
    VALUES(ws,invoice_id,1000,workspace_currency,current_date,requester,payment_key);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    blocked := position('approval_required' in SQLERRM)>0;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Invoice payment bypassed approval gate'; END IF;

  result := public.global_enterprise_action(requester,ws,'approval.request',
    jsonb_build_object('actionType','invoice.payment.record','resourceType','invoice','resourceId',invoice_id::text,
      'payload',jsonb_build_object('amountMinor','1000','currencyCode',workspace_currency,'eventDate',to_char(current_date,'YYYY-MM-DD'))));
  IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'Invoice payment approval request failed: %',result; END IF;
  request_id := (result->>'requestId')::uuid;
  result := public.global_enterprise_action(approver,ws,'approval.decide',
    jsonb_build_object('requestId',request_id::text,'decision','approved','note','Payment approved'));
  IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'Invoice payment approval decision failed: %',result; END IF;

  INSERT INTO global.invoice_payments(workspace_id,invoice_id,amount_minor,currency_code,payment_date,recorded_by,idempotency_key)
  VALUES(ws,invoice_id,1000,workspace_currency,current_date,requester,payment_key)
  RETURNING id INTO payment_id;
  IF payment_id IS NULL THEN RAISE EXCEPTION 'Approved invoice payment was not recorded'; END IF;

  DELETE FROM global.approval_policies WHERE workspace_id=ws AND resource_type='invoice';
END
$part9_invoice_approval$;
RESET ROLE;
