\set ON_ERROR_STOP on
-- Disposable runtime security test for the additive Global isolation migration.
-- Uses synthetic identities only; never connects to hosted Supabase.
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data)
VALUES
 ('11111111-1111-4111-8111-111111111111','india-owner@example.test','{}'::jsonb,'{}'::jsonb),
 ('22222222-2222-4222-8222-222222222222','global-a@example.test','{}'::jsonb,'{}'::jsonb),
 ('33333333-3333-4333-8333-333333333333','global-b@example.test','{}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SET ROLE service_role;
INSERT INTO global.workspaces(id,name,country_code,locale_code,currency_code,created_by)
VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Global Workspace A','GB','en-GB','GBP','22222222-2222-4222-8222-222222222222'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Global Workspace B','US','en-US','USD','33333333-3333-4333-8333-333333333333');
INSERT INTO global.user_profiles(user_id,email,full_name,default_workspace_id)
VALUES
 ('22222222-2222-4222-8222-222222222222','global-a@example.test','Global User A','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('33333333-3333-4333-8333-333333333333','global-b@example.test','Global User B','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO global.workspace_members(workspace_id,user_id,role,status)
VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','owner','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','owner','active');
INSERT INTO global.business_profiles(workspace_id,legal_name,display_name,country_code,locale_code,currency_code)
VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Workspace A Ltd','Workspace A','GB','en-GB','GBP'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Workspace B Inc','Workspace B','US','en-US','USD');
RESET ROLE;

-- Anonymous users must not obtain schema access to Global tables.
SET ROLE anon;
DO $anon_denial$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM count(*) FROM global.workspaces;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'anon unexpectedly accessed global.workspaces'; END IF;
END
$anon_denial$;
RESET ROLE;

-- User A sees only A's workspace, profile and membership.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $user_a$
BEGIN
  IF (SELECT count(*) FROM global.workspaces) <> 1
     OR NOT EXISTS (SELECT 1 FROM global.workspaces WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
     OR EXISTS (SELECT 1 FROM global.workspaces WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') THEN
    RAISE EXCEPTION 'Global user A can see another workspace or cannot see its own';
  END IF;
  IF (SELECT count(*) FROM global.workspace_members) <> 1
     OR (SELECT count(*) FROM global.business_profiles) <> 1
     OR (SELECT count(*) FROM global.user_profiles) <> 1 THEN
    RAISE EXCEPTION 'Global user A workspace/profile isolation failed';
  END IF;
  IF NOT global.is_workspace_admin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
     OR global.is_workspace_member('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') THEN
    RAISE EXCEPTION 'Global user A membership helper crossed workspace boundary';
  END IF;
END
$user_a$;

-- User B sees only B's records.
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
DO $user_b$
BEGIN
  IF (SELECT count(*) FROM global.workspaces) <> 1
     OR NOT EXISTS (SELECT 1 FROM global.workspaces WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
     OR EXISTS (SELECT 1 FROM global.workspaces WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') THEN
    RAISE EXCEPTION 'Global user B can see another workspace or cannot see its own';
  END IF;
  IF (SELECT count(*) FROM global.workspace_members) <> 1
     OR (SELECT count(*) FROM global.business_profiles) <> 1
     OR (SELECT count(*) FROM global.user_profiles) <> 1 THEN
    RAISE EXCEPTION 'Global user B workspace/profile isolation failed';
  END IF;
  IF NOT global.is_workspace_admin('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
     OR global.is_workspace_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') THEN
    RAISE EXCEPTION 'Global user B membership helper crossed workspace boundary';
  END IF;
END
$user_b$;

-- An India-only public.profiles row is not a Global profile or membership.
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $india_separation$
BEGIN
  IF (SELECT count(*) FROM global.workspaces) <> 0
     OR (SELECT count(*) FROM global.workspace_members) <> 0
     OR (SELECT count(*) FROM global.user_profiles) <> 0
     OR global.is_workspace_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
     OR global.is_workspace_admin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') THEN
    RAISE EXCEPTION 'India public profile alone granted Global access or admin role';
  END IF;
END
$india_separation$;

-- Authenticated users cannot provision privileged membership/profile rows directly.
DO $write_denial$
BEGIN
  IF has_table_privilege(current_user,'global.workspaces','INSERT')
     OR has_table_privilege(current_user,'global.workspace_members','INSERT')
     OR has_table_privilege(current_user,'global.user_profiles','INSERT')
     OR has_table_privilege(current_user,'global.workspace_members','DELETE') THEN
    RAISE EXCEPTION 'Authenticated role has direct Global provisioning privileges';
  END IF;
END
$write_denial$;
RESET ROLE;

SELECT 'PASS: two-workspace Global RLS, anon denial, India-profile separation and least-privilege checks' AS result;
