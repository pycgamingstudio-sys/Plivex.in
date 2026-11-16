\set ON_ERROR_STOP on
-- Runs after the Global business, tax and FX integration fixtures in a disposable database.
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data)
VALUES ('77777777-7777-4777-8777-777777777777','enterprise-manager@example.test','{}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
SET ROLE service_role;
INSERT INTO global.workspace_members(workspace_id,user_id,role,status)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','77777777-7777-4777-8777-777777777777','manager','active')
ON CONFLICT (workspace_id,user_id) DO UPDATE SET role='manager',status='active';
DO $enterprise_controls$
DECLARE request_result jsonb; cancel_result jsonb; claim_result jsonb; cleanup_result jsonb;
  request_id uuid; old_event_id bigint; delete_rejected boolean:=false;
BEGIN
  IF NOT public.global_can_export('77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc','invoices')
    OR public.global_can_export('77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc','full_account')
    OR public.global_can_export('77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc','audit_log') THEN
    RAISE EXCEPTION 'Default manager export permissions are not least-privilege';
  END IF;
  INSERT INTO global.workspace_permission_overrides(workspace_id,role,permission_key,effect,created_by)
  VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','manager','export.request','deny','66666666-6666-4666-8666-666666666666');
  IF public.global_can_export('77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc','invoices') THEN RAISE EXCEPTION 'Role export deny ignored'; END IF;
  DELETE FROM global.workspace_permission_overrides WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND role='manager' AND permission_key='export.request';
  INSERT INTO global.workspace_permission_overrides(workspace_id,role,permission_key,effect,created_by)
  VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','manager','audit.read','grant','66666666-6666-4666-8666-666666666666');
  IF NOT public.global_can_export('77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc','audit_log') THEN RAISE EXCEPTION 'Audit export grant ignored'; END IF;
  DELETE FROM global.workspace_permission_overrides WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND role='manager' AND permission_key='audit.read';

  request_result:=public.global_enterprise_action('77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'approval.request',jsonb_build_object('actionType','expense.approve','resourceType','expense','resourceId','EXP-TEST-01'));
  IF request_result->>'ok'<>'true' THEN RAISE EXCEPTION 'Manager could not request approval: %',request_result; END IF;
  request_id:=(request_result->>'requestId')::uuid;
  cancel_result:=public.global_cancel_approval_request('77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc',request_id);
  IF cancel_result->>'ok'<>'true' OR (SELECT status FROM global.approval_requests WHERE id=request_id)<>'cancelled' THEN
    RAISE EXCEPTION 'Requester cancellation failed: %',cancel_result;
  END IF;

  INSERT INTO global.export_jobs(id,workspace_id,requested_by,export_type,format,status)
  VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cccccccc-cccc-4ccc-8ccc-cccccccccccc','77777777-7777-4777-8777-777777777777','invoices','csv','queued');
  INSERT INTO global.workspace_permission_overrides(workspace_id,member_id,permission_key,effect,created_by)
  SELECT 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',id,'export.request','deny','66666666-6666-4666-8666-666666666666'
  FROM global.workspace_members WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND user_id='77777777-7777-4777-8777-777777777777';
  claim_result:=public.global_export_claim('77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  IF claim_result->>'code'<>'EXPORT_PERMISSION_DENIED'
    OR (SELECT status FROM global.export_jobs WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')<>'queued' THEN
    RAISE EXCEPTION 'Revoked export permission did not block queue claim: %',claim_result;
  END IF;
  DELETE FROM global.workspace_permission_overrides WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    AND permission_key='export.request' AND member_id IN (SELECT id FROM global.workspace_members WHERE user_id='77777777-7777-4777-8777-777777777777');

  INSERT INTO global.workspace_retention_policies(workspace_id,audit_retention_days,export_retention_days)
  VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',30,7)
  ON CONFLICT(workspace_id) DO UPDATE SET audit_retention_days=30,export_retention_days=7;
  INSERT INTO global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,occurred_at)
  VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','77777777-7777-4777-8777-777777777777','test.expired','test','retention-fixture',now()-interval '400 days')
  RETURNING id INTO old_event_id;
  BEGIN DELETE FROM global.audit_events WHERE id=old_event_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN delete_rejected:=true; END;
  IF NOT delete_rejected THEN RAISE EXCEPTION 'Audit history allowed direct deletion'; END IF;
  cleanup_result:=public.global_retention_cleanup_audit('66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  IF cleanup_result->>'ok'<>'true' OR (cleanup_result->>'auditEventsDeleted')::integer<1
    OR EXISTS(SELECT 1 FROM global.audit_events WHERE id=old_event_id)
    OR NOT EXISTS(SELECT 1 FROM global.audit_events WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND action='retention.cleanup') THEN
    RAISE EXCEPTION 'Controlled audit retention cleanup failed: %',cleanup_result;
  END IF;
END
$enterprise_controls$;
RESET ROLE;
SET ROLE authenticated;
DO $enterprise_privileges$
BEGIN
  IF has_function_privilege('authenticated','public.global_can_export(uuid,uuid,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.global_cancel_approval_request(uuid,uuid,uuid)','EXECUTE')
    OR has_table_privilege('authenticated','global.audit_events','DELETE') THEN
    RAISE EXCEPTION 'Authenticated role has direct enterprise security-sensitive privileges';
  END IF;
END
$enterprise_privileges$;
RESET ROLE;
SELECT 'PASS Global enterprise export reauthorization, approval cancellation, immutable audit deletion guard and controlled retention cleanup' AS result;
