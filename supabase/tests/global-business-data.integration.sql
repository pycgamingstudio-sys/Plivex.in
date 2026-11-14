\set ON_ERROR_STOP on
-- Synthetic identities and fixtures in the disposable CI database only.
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data)
VALUES
 ('66666666-6666-4666-8666-666666666666','global-data-a@example.test','{}'::jsonb,'{}'::jsonb),
 ('77777777-7777-4777-8777-777777777777','global-data-b@example.test','{}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SET ROLE service_role;
INSERT INTO global.workspaces(id,name,country_code,locale_code,currency_code,created_by)
VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Data Workspace A','GB','en-GB','GBP','66666666-6666-4666-8666-666666666666'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Data Workspace B','US','en-US','USD','77777777-7777-4777-8777-777777777777');
INSERT INTO global.workspace_members(workspace_id,user_id,role,status)
VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','66666666-6666-4666-8666-666666666666','owner','active'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','77777777-7777-4777-8777-777777777777','owner','active');
INSERT INTO global.clients(id,workspace_id,name,created_by)
VALUES
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Client A','66666666-6666-4666-8666-666666666666'),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Client B','77777777-7777-4777-8777-777777777777');
INSERT INTO global.products(id,workspace_id,name,currency_code,created_by)
VALUES
 ('11111111-aaaa-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Product A','GBP','66666666-6666-4666-8666-666666666666'),
 ('22222222-bbbb-4222-8222-222222222222','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Product B','USD','77777777-7777-4777-8777-777777777777');
INSERT INTO global.stock_levels(workspace_id,product_id,quantity)
VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-aaaa-4111-8111-111111111111',12),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-bbbb-4222-8222-222222222222',27);
INSERT INTO global.stock_movements(workspace_id,product_id,movement_type,quantity_delta,created_by)
VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-aaaa-4111-8111-111111111111','receipt',12,'66666666-6666-4666-8666-666666666666'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-bbbb-4222-8222-222222222222','receipt',27,'77777777-7777-4777-8777-777777777777');
INSERT INTO global.invoices(id,workspace_id,client_id,invoice_number,currency_code,total_minor,created_by)
VALUES
 ('33333333-cccc-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','A-001','GBP',12500,'66666666-6666-4666-8666-666666666666'),
 ('44444444-dddd-4444-8444-444444444444','dddddddd-dddd-4ddd-8ddd-dddddddddddd','ffffffff-ffff-4fff-8fff-ffffffffffff','B-001','USD',25000,'77777777-7777-4777-8777-777777777777');
INSERT INTO global.invoice_items(workspace_id,invoice_id,description,quantity,unit_price_minor,line_total_minor)
VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-cccc-4333-8333-333333333333','Item A',1,12500,12500),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','44444444-dddd-4444-8444-444444444444','Item B',1,25000,25000);
INSERT INTO global.invoice_payments(workspace_id,invoice_id,amount_minor,currency_code,recorded_by)
VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-cccc-4333-8333-333333333333',5000,'GBP','66666666-6666-4666-8666-666666666666'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','44444444-dddd-4444-8444-444444444444',7000,'USD','77777777-7777-4777-8777-777777777777');
INSERT INTO global.expenses(workspace_id,category,amount_minor,currency_code,created_by)
VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Office',1500,'GBP','66666666-6666-4666-8666-666666666666'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Travel',2200,'USD','77777777-7777-4777-8777-777777777777');
RESET ROLE;

SET ROLE anon;
DO $anon_business_denial$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM count(*) FROM global.clients;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'anon accessed Global business data'; END IF;
END
$anon_business_denial$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',false);
DO $workspace_a$
DECLARE
  table_name text;
  visible_count bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['clients','products','stock_levels','stock_movements','invoices','invoice_items','invoice_payments','expenses'] LOOP
    EXECUTE format('SELECT count(*) FROM global.%I', table_name) INTO visible_count;
    IF visible_count <> 1 THEN RAISE EXCEPTION 'Workspace A expected one % row, saw %', table_name, visible_count; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM global.clients WHERE name='Client A')
     OR EXISTS (SELECT 1 FROM global.clients WHERE name='Client B')
     OR EXISTS (SELECT 1 FROM global.invoices WHERE invoice_number='B-001')
     OR EXISTS (SELECT 1 FROM global.expenses WHERE category='Travel') THEN
    RAISE EXCEPTION 'Workspace A can see Workspace B business data';
  END IF;
END
$workspace_a$;

SELECT set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',false);
DO $workspace_b$
BEGIN
  IF (SELECT count(*) FROM global.clients) <> 1
     OR NOT EXISTS (SELECT 1 FROM global.clients WHERE name='Client B')
     OR EXISTS (SELECT 1 FROM global.clients WHERE name='Client A')
     OR (SELECT count(*) FROM global.invoices) <> 1
     OR (SELECT count(*) FROM global.products) <> 1
     OR (SELECT count(*) FROM global.stock_movements) <> 1
     OR (SELECT count(*) FROM global.expenses) <> 1 THEN
    RAISE EXCEPTION 'Workspace B business-data isolation failed';
  END IF;
END
$workspace_b$;

-- Authenticated can read tenant-scoped rows, but all writes stay server-only.
DO $least_privilege$
BEGIN
  IF has_table_privilege('authenticated','global.clients','INSERT')
     OR has_table_privilege('authenticated','global.clients','UPDATE')
     OR has_table_privilege('authenticated','global.invoices','DELETE')
     OR has_table_privilege('authenticated','global.stock_levels','INSERT')
     OR has_table_privilege('authenticated','global.stock_movements','INSERT')
     OR has_table_privilege('authenticated','global.expenses','UPDATE') THEN
    RAISE EXCEPTION 'Authenticated role has direct Global business write privileges';
  END IF;
END
$least_privilege$;
RESET ROLE;

-- Private service-role RPC rechecks workspace membership and keeps global schema unexposed.
SET ROLE service_role;
DO $global_records_rpc$
DECLARE
  result jsonb;
  created_id uuid;
BEGIN
  result := public.global_business_records(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'clients','list',null,'{}'::jsonb,10
  );
  IF result->>'ok' <> 'true' OR jsonb_array_length(result->'records') <> 1
     OR result->'records'->0->>'name' <> 'Client A' THEN
    RAISE EXCEPTION 'Global service RPC list did not enforce workspace A';
  END IF;

  result := public.global_business_records(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'clients','create',null,'{"name":"RPC Client"}'::jsonb,10
  );
  IF result->>'ok' <> 'true' OR result->'record'->>'created_by' <> '66666666-6666-4666-8666-666666666666' THEN
    RAISE EXCEPTION 'Global service RPC create failed or used the wrong creator';
  END IF;
  created_id := (result->'record'->>'id')::uuid;

  result := public.global_business_records(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'clients','update',created_id,'{"name":"RPC Client Updated"}'::jsonb,10
  );
  IF result->>'ok' <> 'true' OR result->'record'->>'name' <> 'RPC Client Updated' THEN
    RAISE EXCEPTION 'Global service RPC update failed';
  END IF;

  result := public.global_business_records(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'clients','delete',created_id,'{}'::jsonb,10
  );
  IF result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Global service RPC delete failed'; END IF;

  result := public.global_business_records(
    '66666666-6666-4666-8666-666666666666',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'clients','list',null,'{}'::jsonb,10
  );
  IF result->>'ok' <> 'false' OR result->>'reason' <> 'access_denied' THEN
    RAISE EXCEPTION 'Global service RPC allowed a user to cross workspaces';
  END IF;

  result := public.global_business_records(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'expenses','create',null,'{"category":"Test","amount_minor":100,"currency_code":"USD"}'::jsonb,10
  );
  IF result->>'ok' <> 'false' OR result->>'reason' <> 'invalid_currency' THEN
    RAISE EXCEPTION 'Global service RPC accepted a foreign workspace currency';
  END IF;

  result := public.global_business_records(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'invoices','create',null,'{}'::jsonb,10
  );
  IF result->>'ok' <> 'false' OR result->>'reason' <> 'read_only' THEN
    RAISE EXCEPTION 'Global service RPC allowed a non-atomic invoice write';
  END IF;
END
$global_records_rpc$;
RESET ROLE;

DO $global_rpc_privileges$
BEGIN
  IF has_function_privilege('anon','public.global_business_records(uuid,uuid,text,text,uuid,jsonb,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.global_business_records(uuid,uuid,text,text,uuid,jsonb,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.global_business_records(uuid,uuid,text,text,uuid,jsonb,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Global records RPC execute grants are not service-role-only';
  END IF;
END
$global_rpc_privileges$;

SELECT 'PASS: Global business tables, two-workspace RLS isolation, anon denial and server-only writes' AS result;
