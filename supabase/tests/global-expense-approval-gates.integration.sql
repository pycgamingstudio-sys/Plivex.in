\set ON_ERROR_STOP on
-- Part 9 approval gate integration checks. Runs in the disposable Global test database.
SET ROLE service_role;
DO $part9_expense_approval$
DECLARE
  result jsonb;
  request_id uuid;
  expense_id uuid;
  expense_key uuid := '99999999-9999-4999-8999-999999999901';
  ws uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  requester uuid := '88888888-8888-4888-8888-888888888888';
  approver uuid := '66666666-6666-4666-8666-666666666666';
  blocked boolean := false;
BEGIN
  result := public.global_set_approval_policy(requester,ws,'expense.create',true,1000,array['owner','admin']::text[],true);
  IF result->>'code' <> 'ADMIN_REQUIRED' THEN RAISE EXCEPTION 'Non-admin changed approval policy: %',result; END IF;
  result := public.global_set_approval_policy(approver,ws,'expense.create',true,1000,array['viewer']::text[],true);
  IF result->>'code' <> 'INVALID_APPROVAL_POLICY' THEN
    RAISE EXCEPTION 'Read-only viewer was accepted as an approver: %',result;
  END IF;
  result := public.global_set_approval_policy(approver,ws,'expense.create',true,1000,array['owner','admin']::text[],false);
  IF result->>'code' <> 'INVALID_APPROVAL_POLICY' THEN
    RAISE EXCEPTION 'Policy allowed self-approval protection to be disabled: %',result;
  END IF;
  result := public.global_set_approval_policy(approver,ws,'expense.create',true,1000,array['owner','admin']::text[],true);
  IF result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Admin could not set create policy: %',result; END IF;
  result := public.global_set_approval_policy(approver,ws,'expense.update',true,1000,array['owner','admin']::text[],true);
  IF result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Admin could not set update policy: %',result; END IF;

  BEGIN
    INSERT INTO global.expenses(workspace_id,category,vendor,amount_minor,currency_code,expense_date,created_by,
      transaction_amount_minor,transaction_currency_code,creation_idempotency_key)
    VALUES (ws,'Travel','Test Vendor',2500,'INR',current_date,requester,2500,'INR',expense_key);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    blocked := position('approval_required' in SQLERRM) > 0;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Expense insert bypassed approval gate'; END IF;

  result := public.global_enterprise_action(requester,ws,'approval.request',
    jsonb_build_object(
      'actionType','expense.create','resourceType','expense','resourceId','*',
      'payload',jsonb_build_object('amountMinor','2500','category','Travel','vendor','Test Vendor',
        'expenseDate',to_char(current_date,'YYYY-MM-DD'),'currencyCode','INR')
    ));
  IF result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Approval request failed: %',result; END IF;
  request_id := (result->>'requestId')::uuid;

  result := public.global_enterprise_action(requester,ws,'approval.decide',
    jsonb_build_object('requestId',request_id::text,'decision','approved','note','Self approval must fail'));
  IF result->>'code' NOT IN ('REQUEST_NOT_DECIDABLE','PERMISSION_DENIED') THEN
    RAISE EXCEPTION 'Requester was able to self-approve: %',result;
  END IF;

  result := public.global_enterprise_action(approver,ws,'approval.decide',
    jsonb_build_object('requestId',request_id::text,'decision','approved','note','Verified expense'));
  IF result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Approval decision failed: %',result; END IF;

  INSERT INTO global.expenses(workspace_id,category,vendor,amount_minor,currency_code,expense_date,created_by,
    transaction_amount_minor,transaction_currency_code,creation_idempotency_key)
  VALUES (ws,'Travel','Test Vendor',2500,'INR',current_date,requester,2500,'INR',expense_key)
  RETURNING id INTO expense_id;
  IF expense_id IS NULL THEN RAISE EXCEPTION 'Approved expense was not created'; END IF;

  blocked := false;
  BEGIN
    UPDATE global.expenses SET vendor='Verified Vendor'
    WHERE id=expense_id AND workspace_id=ws;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    blocked := position('approval_required' in SQLERRM) > 0;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Expense update bypassed approval gate'; END IF;

  result := public.global_enterprise_action(requester,ws,'approval.request',
    jsonb_build_object(
      'actionType','expense.update','resourceType','expense','resourceId',expense_id::text,
      'payload',jsonb_build_object('amountMinor','2500','category','Travel','vendor','Verified Vendor',
        'expenseDate',to_char(current_date,'YYYY-MM-DD'),'currencyCode','INR')
    ));
  IF result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Expense update approval request failed: %',result; END IF;
  request_id := (result->>'requestId')::uuid;
  result := public.global_enterprise_action(approver,ws,'approval.decide',
    jsonb_build_object('requestId',request_id::text,'decision','approved','note','Verified expense change'));
  IF result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Expense update approval decision failed: %',result; END IF;

  UPDATE global.expenses SET vendor='Verified Vendor'
  WHERE id=expense_id AND workspace_id=ws;
  IF NOT EXISTS (SELECT 1 FROM global.expenses WHERE id=expense_id AND vendor='Verified Vendor') THEN
    RAISE EXCEPTION 'Approved expense update was not applied';
  END IF;

  blocked := false;
  BEGIN
    UPDATE global.expenses SET vendor='Unapproved Vendor'
    WHERE id=expense_id AND workspace_id=ws;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    blocked := position('approval_required' in SQLERRM) > 0
      OR position('approval_already_consumed' in SQLERRM) > 0;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Consumed approval was replayed for another expense update'; END IF;

  DELETE FROM global.approval_policies WHERE workspace_id=ws AND resource_type='expense';
END
$part9_expense_approval$;
RESET ROLE;
