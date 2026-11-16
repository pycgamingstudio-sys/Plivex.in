\set ON_ERROR_STOP on
-- Runs after the Global business, tax and FX integration fixtures in a disposable database.
-- Insert an expired audit row as the disposable database owner so the retention RPC
-- can prove its controlled-delete exception; ordinary deletes must be rejected.
INSERT INTO global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,occurred_at)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','88888888-8888-4888-8888-888888888888',
  'test.expired','test','retention-fixture',now()-interval '400 days');
DO $audit_delete_guard$
DECLARE denied boolean:=false;
BEGIN
  BEGIN
    DELETE FROM global.audit_events
    WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND entity_id='retention-fixture';
  EXCEPTION WHEN SQLSTATE '55000' THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Audit history allowed direct deletion'; END IF;
END
$audit_delete_guard$;

SET ROLE service_role;
DO $enterprise_controls$
DECLARE
  result jsonb;
  request_result jsonb;
  cancel_result jsonb;
  export_result jsonb;
  claim_result jsonb;
  cleanup_result jsonb;
  request_id uuid;
  job_id uuid;
  manager_id uuid;
BEGIN
  SELECT id INTO manager_id FROM global.workspace_members
  WHERE workspace_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    AND user_id='88888888-8888-4888-8888-888888888888' AND status='active';

  IF NOT public.global_can_export('88888888-8888-4888-8888-888888888888','cccccccc-cccc-4ccc-8ccc-cccccccccccc','invoices')
    OR public.global_can_export('88888888-8888-4888-8888-888888888888','cccccccc-cccc-4ccc-8ccc-cccccccccccc','full_account')
    OR public.global_can_export('88888888-8888-4888-8888-888888888888','cccccccc-cccc-4ccc-8ccc-cccccccccccc','audit_log') THEN
    RAISE EXCEPTION 'Default manager export permissions are not least-privilege';
  END IF;

  result:=public.global_enterprise_action('66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','permission.set',
    jsonb_build_object('role','manager','permissionKey','export.request','effect','deny'));
  IF result->>'ok'<>'true' OR public.global_can_export('88888888-8888-4888-8888-888888888888',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','invoices') THEN
    RAISE EXCEPTION 'Role-level export deny was not enforced: %',result;
  END IF;
  PERFORM public.global_enterprise_action('66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','permission.set',
    jsonb_build_object('role','manager','permissionKey','export.request','effect','grant'));

  result:=public.global_enterprise_action('66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','permission.set',
    jsonb_build_object('role','manager','permissionKey','audit.read','effect','grant'));
  IF result->>'ok'<>'true' OR NOT public.global_can_export('88888888-8888-4888-8888-888888888888',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','audit_log') THEN
    RAISE EXCEPTION 'Explicit audit-log grant was not enforced: %',result;
  END IF;

  request_result:=public.global_enterprise_action('88888888-8888-4888-8888-888888888888',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','approval.request',
    jsonb_build_object('actionType','expense.approve','resourceType','expense','resourceId','EXP-TEST-01'));
  IF request_result->>'ok'<>'true' THEN RAISE EXCEPTION 'Manager could not request approval: %',request_result; END IF;
  request_id:=(request_result->>'requestId')::uuid;
  cancel_result:=public.global_cancel_approval_request('88888888-8888-4888-8888-888888888888',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',request_id);
  IF cancel_result->>'ok'<>'true'
    OR (SELECT status FROM global.approval_requests WHERE id=request_id)<>'cancelled' THEN
    RAISE EXCEPTION 'Requester cancellation failed: %',cancel_result;
  END IF;

  export_result:=public.global_enterprise_action('88888888-8888-4888-8888-888888888888',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','export.request',
    jsonb_build_object('exportType','invoices','format','csv'));
  IF export_result->>'ok'<>'true' THEN RAISE EXCEPTION 'Manager could not request permitted export: %',export_result; END IF;
  job_id:=(export_result->>'jobId')::uuid;
  PERFORM public.global_enterprise_action('66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','permission.set',
    jsonb_build_object('memberId',manager_id,'permissionKey','export.request','effect','deny'));
  claim_result:=public.global_export_claim('88888888-8888-4888-8888-888888888888',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',job_id);
  IF claim_result->>'code'<>'EXPORT_PERMISSION_DENIED'
    OR (SELECT status FROM global.export_jobs WHERE id=job_id)<>'queued' THEN
    RAISE EXCEPTION 'Revoked export permission did not block queue claim: %',claim_result;
  END IF;

  PERFORM public.global_enterprise_action('66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','retention.set',
    jsonb_build_object('auditRetentionDays',30,'exportRetentionDays',7));
  cleanup_result:=public.global_retention_cleanup_audit('66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  IF cleanup_result->>'ok'<>'true'
    OR (cleanup_result->>'auditEventsDeleted')::integer<1
    OR EXISTS(SELECT 1 FROM global.audit_events WHERE entity_id='retention-fixture')
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
