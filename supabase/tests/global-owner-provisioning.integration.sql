\set ON_ERROR_STOP on
-- Disposable Global owner provisioning RPC tests. Synthetic Auth identities only.
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data)
VALUES
 ('44444444-4444-4444-8444-444444444444','global-owner@example.test','{}'::jsonb,'{}'::jsonb),
 ('55555555-5555-4555-8555-555555555555','global-invited@example.test','{}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SET ROLE service_role;
DO $provision_owner$
DECLARE
  first_result jsonb;
  repeat_result jsonb;
  context_result jsonb;
  update_result jsonb;
  workspace_id uuid;
BEGIN
  first_result := public.global_provision_owner_workspace(
    '44444444-4444-4444-8444-444444444444',
    'GLOBAL-OWNER@example.test',
    'Global Owner',
    'GB','en-GB','GBP'
  );
  IF first_result->>'ok' <> 'true' OR first_result->>'created' <> 'true'
     OR first_result->>'role' <> 'owner' THEN
    RAISE EXCEPTION 'Global owner provisioning failed: %', first_result;
  END IF;
  workspace_id := (first_result->>'workspace_id')::uuid;

  repeat_result := public.global_provision_owner_workspace(
    '44444444-4444-4444-8444-444444444444',
    'global-owner@example.test',
    'Global Owner Updated',
    'US','en-US','USD'
  );
  IF repeat_result->>'ok' <> 'true' OR repeat_result->>'created' <> 'false'
     OR (repeat_result->>'workspace_id')::uuid <> workspace_id
     OR repeat_result->>'country_code' <> 'GB' THEN
    RAISE EXCEPTION 'Repeated Global owner bootstrap was not idempotent: %', repeat_result;
  END IF;
  IF (SELECT count(*) FROM global.workspaces WHERE created_by='44444444-4444-4444-8444-444444444444') <> 1
     OR (SELECT count(*) FROM global.workspace_members WHERE user_id='44444444-4444-4444-8444-444444444444') <> 1 THEN
    RAISE EXCEPTION 'Repeated owner bootstrap created duplicate Global workspaces or memberships';
  END IF;

  context_result := public.global_get_auth_context('44444444-4444-4444-8444-444444444444');
  IF context_result->'membership'->>'role' <> 'owner'
     OR (context_result->'workspace'->>'id')::uuid <> workspace_id
     OR context_result->'workspace'->>'currency_code' <> 'GBP' THEN
    RAISE EXCEPTION 'Global auth-context RPC returned an incorrect workspace: %', context_result;
  END IF;

  update_result := public.global_update_user_profile(
    '44444444-4444-4444-8444-444444444444',
    'Owner Display Name',
    'https://example.test/avatar.png',
    '+442000000000'
  );
  IF update_result->>'ok' <> 'true'
     OR update_result->>'full_name' <> 'Owner Display Name'
     OR update_result->>'phone' <> '+442000000000' THEN
    RAISE EXCEPTION 'Global profile update failed: %', update_result;
  END IF;

  IF (SELECT role FROM global.workspace_members WHERE user_id='44444444-4444-4444-8444-444444444444') <> 'owner'
     OR (SELECT country_code FROM global.workspaces WHERE id=workspace_id) <> 'GB' THEN
    RAISE EXCEPTION 'Profile update altered authorization or workspace country';
  END IF;

  IF public.global_provision_owner_workspace(
    '44444444-4444-4444-8444-444444444444',
    'global-owner@example.test','Global Owner','GB','en-US','GBP'
  )->>'reason' <> 'unsupported_country_locale_currency' THEN
    RAISE EXCEPTION 'Invalid country/locale/currency tuple was accepted';
  END IF;
END
$provision_owner$;

-- An invited member must never fall through into a new standalone owner workspace.
INSERT INTO global.workspace_members(workspace_id,user_id,role,status,invited_by)
VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '55555555-5555-4555-8555-555555555555',
  'employee','invited',
  '22222222-2222-4222-8222-222222222222'
);
DO $invited_member$
DECLARE result jsonb;
BEGIN
  result := public.global_provision_owner_workspace(
    '55555555-5555-4555-8555-555555555555',
    'global-invited@example.test','Invited User','US','en-US','USD'
  );
  IF result->>'ok' <> 'false' OR result->>'reason' <> 'membership_requires_review' THEN
    RAISE EXCEPTION 'Pending Global invitation was converted into owner access: %', result;
  END IF;
  IF EXISTS (SELECT 1 FROM global.workspaces WHERE created_by='55555555-5555-4555-8555-555555555555')
     OR EXISTS (SELECT 1 FROM global.workspace_members WHERE user_id='55555555-5555-4555-8555-555555555555' AND role='owner') THEN
    RAISE EXCEPTION 'Invited Global user received a separate owner workspace';
  END IF;
END
$invited_member$;

-- The public wrapper is not callable by browser roles.
DO $rpc_privileges$
BEGIN
  IF has_function_privilege('anon','public.global_get_auth_context(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.global_get_auth_context(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.global_provision_owner_workspace(uuid,text,text,text,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.global_provision_owner_workspace(uuid,text,text,text,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.global_update_user_profile(uuid,text,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.global_update_user_profile(uuid,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'A browser role can execute a service-role-only Global RPC';
  END IF;
  IF NOT has_function_privilege('service_role','public.global_get_auth_context(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.global_provision_owner_workspace(uuid,text,text,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.global_update_user_profile(uuid,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing a Global RPC grant';
  END IF;
END
$rpc_privileges$;
RESET ROLE;

SELECT 'PASS: idempotent Global owner provisioning, invite safety, auth context and service-role-only RPCs' AS result;
