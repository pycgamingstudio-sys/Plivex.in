-- Disposable India compatibility sentinel. No production data is used.
SET session_replication_role = replica;
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
VALUES ('11111111-1111-4111-8111-111111111111','india-owner@example.test','{}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
SET session_replication_role = origin;
SET request.jwt.claim.role = 'service_role';

-- Recreate the existing India Basic entitlement baseline before later
-- edition-specific migrations run. The local no-op migration must preserve it.
INSERT INTO public.plan_features (plan, feature, allowed)
VALUES ('basic', 'lead_pipeline', true)
ON CONFLICT (plan, feature) DO UPDATE SET allowed = EXCLUDED.allowed;

INSERT INTO public.plan_limits (plan, resource, max_count, period)
VALUES ('basic', 'leads', 200, 'total')
ON CONFLICT (plan, resource) DO UPDATE
SET max_count = EXCLUDED.max_count, period = EXCLUDED.period;

INSERT INTO public.profiles (id, email, full_name, role, workspace_id)
VALUES ('11111111-1111-4111-8111-111111111111','india-owner@example.test','India Regression Owner','admin','workspace-india-regression')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscriptions (
  id, user_id, user_email, workspace_id, plan_id, plan_name, tier, status,
  amount, currency, gateway, payu_txnid, payu_payment_id, started_at, expires_at,
  amount_paise, txnid, provider
) VALUES (
  '22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
  'india-owner@example.test','workspace-india-regression','basic_yearly','Basic Yearly',
  'basic','active',1299,'INR','payu','PAYU-INDIA-REGRESSION-001',
  'PAYU-PAYMENT-REGRESSION-001',now()-interval '10 days',now()+interval '355 days',
  129900,'PAYU-INDIA-REGRESSION-001','payu'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payment_logs (
  user_id, user_email, workspace_id, gateway, txnid, payu_payment_id,
  plan_id, plan_name, tier, amount, currency, gateway_status, outcome,
  message, source, hash_verified, verified_at
) VALUES (
  '11111111-1111-4111-8111-111111111111','india-owner@example.test',
  'workspace-india-regression','payu','PAYU-INDIA-REGRESSION-001',
  'PAYU-PAYMENT-REGRESSION-001','basic_yearly','Basic Yearly','basic',
  129900,'INR','success','applied','Disposable India regression sentinel',
  'stage4-migration-replay',true,now()
);
RESET request.jwt.claim.role;
