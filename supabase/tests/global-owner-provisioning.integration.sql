\set ON_ERROR_STOP on
-- Disposable Global owner provisioning RPC tests. Synthetic Auth identities only.
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data)
VALUES
 ('44444444-4444-4444-8444-444444444444','global-owner@example.test','{}'::jsonb,'{}'::jsonb),
 ('55555555-5555-4555-8555-555555555555','global-invited@example.test','{}'::jsonb,'{}'::jsonb),
 ('66666666-6666-4666-8666-666666666666','global-in@example.test','{}'::jsonb,'{}'::jsonb),
 ('77777777-7777-4777-8777-777777777777','global-us@example.test','{}'::jsonb,'{}'::jsonb),
 ('88888888-8888-4888-8888-888888888888','global-ae@example.test','{}'::jsonb,'{}'::jsonb),
 ('99999999-9999-4999-8999-999999999999','global-ca@example.test','{}'::jsonb,'{}'::jsonb),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','global-au@example.test','{}'::jsonb,'{}'::jsonb),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','global-sg@example.test','{}'::jsonb,'{}'::jsonb)
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

-- Verify that each selectable country can provision an isolated workspace with
-- its exact locale/currency tuple. These are synthetic Auth users in disposable CI.
DO $all_country_provisioning$
DECLARE
  test_case record;
  result jsonb;
BEGIN
  FOR test_case IN
    SELECT * FROM (VALUES
      ('66666666-6666-4666-8666-666666666666'::uuid, 'IN', 'en-IN', 'INR'),
      ('77777777-7777-4777-8777-777777777777'::uuid, 'US', 'en-US', 'USD'),
      ('88888888-8888-4888-8888-888888888888'::uuid, 'AE', 'ar-AE', 'AED'),
      ('99999999-9999-4999-8999-999999999999'::uuid, 'CA', 'fr-CA', 'CAD'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'::uuid, 'AU', 'en-AU', 'AUD'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'SG', 'ta-SG', 'SGD')
    ) AS countries(user_id, country_code, locale_code, currency_code)
  LOOP
    result := public.global_provision_owner_workspace(
      test_case.user_id,
      'country-test@example.test',
      'Country Test Owner',
      test_case.country_code,
      test_case.locale_code,
      test_case.currency_code
    );
    IF result->>'ok' <> 'true'
       OR result->>'created' <> 'true'
       OR result->>'role' <> 'owner'
       OR result->>'country_code' <> test_case.country_code
       OR result->>'locale_code' <> test_case.locale_code
       OR result->>'currency_code' <> test_case.currency_code THEN
      RAISE EXCEPTION 'Country workspace provisioning failed for %: %', test_case.country_code, result;
    END IF;
  END LOOP;
END
$all_country_provisioning$;

-- Remove the six synthetic workspaces so later disposable integration fixtures
-- start from their expected clean Global schema state.
DELETE FROM global.workspaces
WHERE created_by IN (
  '66666666-6666-4666-8666-666666666666',
  '77777777-7777-4777-8777-777777777777',
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999999',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
);
DELETE FROM auth.users
WHERE id IN (
  '66666666-6666-4666-8666-666666666666',
  '77777777-7777-4777-8777-777777777777',
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999999',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
);

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
