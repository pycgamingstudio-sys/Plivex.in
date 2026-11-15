\set ON_ERROR_STOP on
-- Country reset integration tests use synthetic identities only in the disposable
-- GitHub Actions replay database. Never point this file at a hosted project.

INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
VALUES
 ('77777777-7777-4777-8777-777777777777','country-reset-global-india@example.test','{"full_name":"Global to India"}'::jsonb,'{}'::jsonb),
 ('88888888-8888-4888-8888-888888888888','country-reset-global-global@example.test','{"full_name":"Global to Global"}'::jsonb,'{}'::jsonb),
 ('99999999-9999-4999-8999-999999999999','country-reset-rollback@example.test','{"full_name":"Rollback Probe Owner"}'::jsonb,'{}'::jsonb),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','country-reset-employee@example.test','{"full_name":"Workspace Employee"}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $fixture_auth$
BEGIN
  IF auth.role() <> 'service_role'
     OR auth.uid() <> '11111111-1111-4111-8111-111111111111'
     OR public.current_workspace_id() <> 'workspace-india-regression' THEN
    RAISE EXCEPTION 'Disposable fixture JWT context was not established correctly';
  END IF;
END
$fixture_auth$;

-- Seed the already-created India regression identity with a realistic owned workspace.
INSERT INTO public.workspace_members(
  membership_key,workspace_id,owner_id,user_id,name,email,role,status,activated_at
) VALUES (
  'workspace-india-regression:india-owner@example.test',
  'workspace-india-regression',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'India Regression Owner','india-owner@example.test','admin','active',now()
) ON CONFLICT DO NOTHING;
INSERT INTO public.business_profile(workspace_id,name)
VALUES ('workspace-india-regression','India Regression Business')
ON CONFLICT DO NOTHING;
INSERT INTO public.clients(workspace_id,name)
VALUES ('workspace-india-regression','India Reset Client')
ON CONFLICT DO NOTHING;
INSERT INTO public.stock(workspace_id,name,quantity,price)
VALUES ('workspace-india-regression','India Reset Product',7,250)
ON CONFLICT DO NOTHING;
INSERT INTO public.expenses(workspace_id,category,amount)
VALUES ('workspace-india-regression','Other',125)
ON CONFLICT DO NOTHING;

DO $india_to_global$
DECLARE
  result jsonb;
  new_workspace_id text;
  old_client_count integer;
BEGIN
  result := public.update_india_workspace_locale('11111111-1111-4111-8111-111111111111','hi-IN');
  IF result->>'ok' <> 'true' OR result->>'locale_code' <> 'hi-IN' THEN
    RAISE EXCEPTION 'India owner locale update failed: %', result;
  END IF;

  result := public.reset_workspace_country_atomic(
    '11111111-1111-4111-8111-111111111111','US','en-US','USD','Disposable India to Global test'
  );
  IF result->>'ok' <> 'true' OR result->>'country_code' <> 'US' THEN
    RAISE EXCEPTION 'India to Global reset failed: %', result;
  END IF;
  new_workspace_id := result->>'workspace_id';

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id='11111111-1111-4111-8111-111111111111' AND workspace_id IS NOT NULL)
     OR (SELECT country_code FROM public.profiles WHERE id='11111111-1111-4111-8111-111111111111') <> 'US'
     OR (SELECT locale_code FROM public.profiles WHERE id='11111111-1111-4111-8111-111111111111') <> 'en-US' THEN
    RAISE EXCEPTION 'India to Global did not update canonical profile edition';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_profile WHERE workspace_id='workspace-india-regression')
     OR EXISTS (SELECT 1 FROM public.clients WHERE workspace_id='workspace-india-regression')
     OR EXISTS (SELECT 1 FROM public.stock WHERE workspace_id='workspace-india-regression')
     OR EXISTS (SELECT 1 FROM public.expenses WHERE workspace_id='workspace-india-regression')
     OR EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id='workspace-india-regression') THEN
    RAISE EXCEPTION 'India business records or team memberships were not fully removed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM global.workspaces WHERE id=new_workspace_id::uuid AND country_code='US' AND locale_code='en-US' AND currency_code='USD')
     OR NOT EXISTS (SELECT 1 FROM global.workspace_members WHERE workspace_id=new_workspace_id::uuid AND user_id='11111111-1111-4111-8111-111111111111' AND role='owner' AND status='active')
     OR NOT EXISTS (SELECT 1 FROM global.business_profiles WHERE workspace_id=new_workspace_id::uuid AND country_code='US') THEN
    RAISE EXCEPTION 'Fresh Global workspace was not provisioned correctly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE id='22222222-2222-4222-8222-222222222222' AND workspace_id=new_workspace_id AND tier='basic' AND status='active' AND currency='INR')
     OR NOT EXISTS (SELECT 1 FROM public.payment_logs WHERE source='stage4-migration-replay' AND workspace_id=new_workspace_id AND currency='INR') THEN
    RAISE EXCEPTION 'Subscription or payment history was not preserved and remapped';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.country_reset_events WHERE user_id='11111111-1111-4111-8111-111111111111' AND old_country_code='IN' AND new_country_code='US') THEN
    RAISE EXCEPTION 'Country reset audit event was not written';
  END IF;

  result := public.reset_workspace_country_atomic(
    '11111111-1111-4111-8111-111111111111','CA','fr-CA','CAD','Cooldown probe'
  );
  IF result->>'ok' <> 'false' OR result->>'reason' <> 'cooldown_active' THEN
    RAISE EXCEPTION '30-day cooldown did not prevent a rapid second country reset: %', result;
  END IF;

  UPDATE public.profiles
  SET workspace_id = null, country_code = 'US', locale_code = 'en-US'
  WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  INSERT INTO global.user_profiles(user_id,email,full_name,default_workspace_id)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','country-reset-employee@example.test','Workspace Employee',new_workspace_id::uuid)
  ON CONFLICT (user_id) DO UPDATE SET email=excluded.email,full_name=excluded.full_name,default_workspace_id=excluded.default_workspace_id;
  INSERT INTO global.workspace_members(workspace_id,user_id,role,status)
  VALUES (new_workspace_id::uuid,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','employee','active');
  result := public.reset_workspace_country_atomic(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CA','fr-CA','CAD','Owner guard probe'
  );
  IF result->>'ok' <> 'false' OR result->>'reason' <> 'workspace_owner_required' THEN
    RAISE EXCEPTION 'Non-owner was able to reset a shared workspace: %', result;
  END IF;
END
$india_to_global$;

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $region_spoof$
BEGIN
  BEGIN
    UPDATE public.profiles SET country_code='CA', locale_code='fr-CA'
    WHERE id='11111111-1111-4111-8111-111111111111';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$region_spoof$;
RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $region_spoof_assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id='11111111-1111-4111-8111-111111111111'
      AND country_code='US' AND locale_code='en-US'
  ) THEN
    RAISE EXCEPTION 'Authenticated profile update spoofed the canonical workspace country or locale';
  END IF;
END
$region_spoof_assert$;

-- Global to India must remove the old Global workspace and create a fresh India workspace.
SELECT set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',false);
INSERT INTO global.workspaces(id,name,country_code,locale_code,currency_code,created_by)
VALUES ('c7777777-7777-4777-8777-777777777777','Global to India Fixture','GB','en-GB','GBP','77777777-7777-4777-8777-777777777777');
INSERT INTO global.user_profiles(user_id,email,full_name,default_workspace_id)
VALUES ('77777777-7777-4777-8777-777777777777','country-reset-global-india@example.test','Global to India','c7777777-7777-4777-8777-777777777777')
ON CONFLICT (user_id) DO UPDATE SET email=excluded.email,full_name=excluded.full_name,default_workspace_id=excluded.default_workspace_id;
INSERT INTO global.workspace_members(workspace_id,user_id,role,status)
VALUES ('c7777777-7777-4777-8777-777777777777','77777777-7777-4777-8777-777777777777','owner','active');
INSERT INTO global.business_profiles(workspace_id,legal_name,display_name,email,country_code,locale_code,currency_code)
VALUES ('c7777777-7777-4777-8777-777777777777','Old Global Ltd','Old Global','country-reset-global-india@example.test','GB','en-GB','GBP');
INSERT INTO global.clients(workspace_id,name,created_by)
VALUES ('c7777777-7777-4777-8777-777777777777','Old Global Client','77777777-7777-4777-8777-777777777777');
INSERT INTO public.profiles(id,email,full_name,role,workspace_id,country_code,locale_code)
VALUES ('77777777-7777-4777-8777-777777777777','country-reset-global-india@example.test','Global to India','admin',null,'GB','en-GB')
ON CONFLICT (id) DO UPDATE SET workspace_id=null,country_code='GB',locale_code='en-GB';
INSERT INTO public.subscriptions(id,user_id,user_email,workspace_id,plan_id,plan_name,tier,status,amount,currency,gateway)
VALUES ('c7777777-7777-4777-8777-777777777778','77777777-7777-4777-8777-777777777777','country-reset-global-india@example.test','c7777777-7777-4777-8777-777777777777','basic_yearly','Basic Yearly','basic','active',1299,'INR','payu');
INSERT INTO public.payment_logs(user_id,user_email,workspace_id,gateway,plan_id,plan_name,tier,amount,currency,outcome,source)
VALUES ('77777777-7777-4777-8777-777777777777','country-reset-global-india@example.test','c7777777-7777-4777-8777-777777777777','payu','basic_yearly','Basic Yearly','basic',129900,'INR','applied','country-reset-global-india');

DO $global_to_india$
DECLARE
  result jsonb;
  new_workspace_id text;
BEGIN
  result := public.reset_workspace_country_atomic(
    '77777777-7777-4777-8777-777777777777','IN','hi-IN','INR','Disposable Global to India test'
  );
  IF result->>'ok' <> 'true' OR result->>'country_code' <> 'IN' THEN
    RAISE EXCEPTION 'Global to India reset failed: %', result;
  END IF;
  new_workspace_id := result->>'workspace_id';
  IF EXISTS (SELECT 1 FROM global.workspaces WHERE id='c7777777-7777-4777-8777-777777777777')
     OR EXISTS (SELECT 1 FROM global.clients WHERE workspace_id='c7777777-7777-4777-8777-777777777777') THEN
    RAISE EXCEPTION 'Old Global workspace or business records were not removed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id='77777777-7777-4777-8777-777777777777' AND workspace_id=new_workspace_id AND country_code='IN' AND locale_code='hi-IN')
     OR NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=new_workspace_id AND user_id='77777777-7777-4777-8777-777777777777' AND role='admin' AND status='active')
     OR NOT EXISTS (SELECT 1 FROM public.business_profile WHERE workspace_id=new_workspace_id) THEN
    RAISE EXCEPTION 'Fresh India workspace was not provisioned correctly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE id='c7777777-7777-4777-8777-777777777778' AND workspace_id=new_workspace_id AND status='active')
     OR NOT EXISTS (SELECT 1 FROM public.payment_logs WHERE source='country-reset-global-india' AND workspace_id=new_workspace_id) THEN
    RAISE EXCEPTION 'Global to India did not preserve subscription and payment history';
  END IF;
END
$global_to_india$;

-- Global to Global uses a new workspace and country-specific currency, without preserving old business rows.
SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',false);
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
VALUES ('88888888-8888-4888-8888-888888888888','country-reset-global-global@example.test','{"full_name":"Global to Global"}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO global.workspaces(id,name,country_code,locale_code,currency_code,created_by)
VALUES ('d8888888-8888-4888-8888-888888888888','Global to Global Fixture','US','en-US','USD','88888888-8888-4888-8888-888888888888');
INSERT INTO global.user_profiles(user_id,email,full_name,default_workspace_id)
VALUES ('88888888-8888-4888-8888-888888888888','country-reset-global-global@example.test','Global to Global','d8888888-8888-4888-8888-888888888888')
ON CONFLICT (user_id) DO UPDATE SET email=excluded.email,full_name=excluded.full_name,default_workspace_id=excluded.default_workspace_id;
INSERT INTO global.workspace_members(workspace_id,user_id,role,status)
VALUES ('d8888888-8888-4888-8888-888888888888','88888888-8888-4888-8888-888888888888','owner','active');
INSERT INTO global.business_profiles(workspace_id,legal_name,display_name,email,country_code,locale_code,currency_code)
VALUES ('d8888888-8888-4888-8888-888888888888','Old US Ltd','Old US','country-reset-global-global@example.test','US','en-US','USD');
INSERT INTO global.clients(workspace_id,name,created_by)
VALUES ('d8888888-8888-4888-8888-888888888888','Old US Client','88888888-8888-4888-8888-888888888888');
INSERT INTO public.profiles(id,email,full_name,role,workspace_id,country_code,locale_code)
VALUES ('88888888-8888-4888-8888-888888888888','country-reset-global-global@example.test','Global to Global','admin',null,'US','en-US')
ON CONFLICT (id) DO UPDATE SET workspace_id=null,country_code='US',locale_code='en-US';

DO $global_to_global$
DECLARE
  result jsonb;
  new_workspace_id text;
BEGIN
  result := public.reset_workspace_country_atomic(
    '88888888-8888-4888-8888-888888888888','CA','fr-CA','CAD','Disposable Global to Global test'
  );
  IF result->>'ok' <> 'true' OR result->>'country_code' <> 'CA' THEN
    RAISE EXCEPTION 'Global to Global reset failed: %', result;
  END IF;
  new_workspace_id := result->>'workspace_id';
  IF new_workspace_id = 'd8888888-8888-4888-8888-888888888888'
     OR EXISTS (SELECT 1 FROM global.workspaces WHERE id='d8888888-8888-4888-8888-888888888888')
     OR EXISTS (SELECT 1 FROM global.clients WHERE workspace_id='d8888888-8888-4888-8888-888888888888') THEN
    RAISE EXCEPTION 'Global to Global reused the old workspace or retained old business records';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM global.workspaces WHERE id=new_workspace_id::uuid AND country_code='CA' AND locale_code='fr-CA' AND currency_code='CAD') THEN
    RAISE EXCEPTION 'Global to Global did not create a fresh country-specific workspace';
  END IF;
END
$global_to_global$;

-- Force a failure after the India workspace has been deleted in the function body.
-- The enclosing subtransaction must restore every old record and membership.
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
INSERT INTO public.profiles(id,email,full_name,role,workspace_id,country_code,locale_code)
VALUES ('99999999-9999-4999-8999-999999999999','country-reset-rollback@example.test','Rollback Probe Owner','admin','workspace-reset-rollback','IN','en-IN');
INSERT INTO public.workspace_members(membership_key,workspace_id,owner_id,user_id,name,email,role,status,activated_at)
VALUES ('workspace-reset-rollback:country-reset-rollback@example.test','workspace-reset-rollback','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','Rollback Probe Owner','country-reset-rollback@example.test','admin','active',now());
INSERT INTO public.business_profile(workspace_id,name)
VALUES ('workspace-reset-rollback','Rollback Business');
INSERT INTO public.clients(workspace_id,name)
VALUES ('workspace-reset-rollback','Rollback Client');

CREATE OR REPLACE FUNCTION public.country_reset_rollback_probe()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.created_by = '99999999-9999-4999-8999-999999999999' THEN
    RAISE EXCEPTION 'country reset rollback probe';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER country_reset_rollback_probe
BEFORE INSERT ON global.workspaces
FOR EACH ROW EXECUTE FUNCTION public.country_reset_rollback_probe();

DO $rollback_probe$
DECLARE
  caught boolean := false;
BEGIN
  BEGIN
    PERFORM public.reset_workspace_country_atomic(
      '99999999-9999-4999-8999-999999999999','US','en-US','USD','Rollback integration test'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'country reset rollback probe' THEN RAISE; END IF;
    caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'Expected rollback trigger did not fire'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id='99999999-9999-4999-8999-999999999999' AND workspace_id='workspace-reset-rollback' AND country_code='IN')
     OR NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id='workspace-reset-rollback' AND user_id='99999999-9999-4999-8999-999999999999')
     OR NOT EXISTS (SELECT 1 FROM public.business_profile WHERE workspace_id='workspace-reset-rollback')
     OR NOT EXISTS (SELECT 1 FROM public.clients WHERE workspace_id='workspace-reset-rollback')
     OR EXISTS (SELECT 1 FROM private.country_reset_state WHERE user_id='99999999-9999-4999-8999-999999999999') THEN
    RAISE EXCEPTION 'Failed country reset left partial deletions or cooldown state behind';
  END IF;
END
$rollback_probe$;

DROP TRIGGER country_reset_rollback_probe ON global.workspaces;
DROP FUNCTION public.country_reset_rollback_probe();
RESET ROLE;

SELECT 'PASS: India/Global country reset transitions, owner checks, cooldown, subscription preservation and transaction rollback' AS result;
