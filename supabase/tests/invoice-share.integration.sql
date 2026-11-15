-- Invoice-share migration and authorization fixture.
-- Runs only in the disposable PostgreSQL 17 CI database.
BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;
ALTER ROLE service_role BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL
);

INSERT INTO auth.users (id) VALUES
  ('10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002');
INSERT INTO public.invoices (id, workspace_id) VALUES
  ('30000000-0000-0000-0000-000000000003', 'workspace-a'),
  ('40000000-0000-0000-0000-000000000004', 'workspace-b');

\ir ../migrations/202611130002_invoice_share_links.sql
\ir ../migrations/202611130003_invoice_share_rate_limit.sql
\ir ../migrations/20261114000000_invoice_share_created_by_index.sql
\ir ../migrations/20261114000000_invoice_share_created_by_index.sql

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $fn$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.assistant_action_batches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL
);
ALTER TABLE public.assistant_action_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own assistant action batches"
  ON public.assistant_action_batches
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
GRANT SELECT ON public.assistant_action_batches TO authenticated;
INSERT INTO public.assistant_action_batches (id,user_id) VALUES
  ('50000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002');

\ir ../migrations/20261114000001_optimize_assistant_batch_rls_policy.sql
\ir ../migrations/20261114000001_optimize_assistant_batch_rls_policy.sql

DO $index_and_policy$
DECLARE v_policy text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class idx ON idx.oid=i.indexrelid
    WHERE i.indrelid='public.invoice_share_links'::regclass
      AND idx.relname='invoice_share_links_created_by_idx'
      AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'invoice_share_links.created_by index is missing or invalid';
  END IF;
  SELECT qual INTO v_policy FROM pg_policies
  WHERE schemaname='public' AND tablename='assistant_action_batches'
    AND policyname='Users read own assistant action batches';
  IF v_policy IS NULL OR position('SELECT AUTH.UID()' IN upper(v_policy))=0 THEN
    RAISE EXCEPTION 'assistant batch RLS policy does not use a scalar SELECT for auth.uid()';
  END IF;
END
$index_and_policy$;

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $workspace_a_rls$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.assistant_action_batches;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Workspace A user must see only their own assistant batch rows'; END IF;
END
$workspace_a_rls$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $workspace_b_rls$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.assistant_action_batches;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Workspace B user must see only their own assistant batch rows'; END IF;
END
$workspace_b_rls$;
RESET ROLE;


-- Supabase's service_role receives table access through platform default grants.
GRANT ALL ON public.invoice_share_links, public.invoice_share_rate_limits TO service_role;

DO $acl$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.invoice_share_links'::regclass) THEN
    RAISE EXCEPTION 'invoice_share_links must have RLS enabled';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.invoice_share_rate_limits'::regclass) THEN
    RAISE EXCEPTION 'invoice_share_rate_limits must have RLS enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('invoice_share_links','invoice_share_rate_limits')) THEN
    RAISE EXCEPTION 'Service-role-only share tables must not expose client RLS policies';
  END IF;
  IF has_table_privilege('anon','public.invoice_share_links','SELECT')
     OR has_table_privilege('authenticated','public.invoice_share_links','SELECT')
     OR has_table_privilege('anon','public.invoice_share_links','INSERT')
     OR has_table_privilege('authenticated','public.invoice_share_links','INSERT') THEN
    RAISE EXCEPTION 'Client roles must not access invoice_share_links directly';
  END IF;
  IF has_table_privilege('anon','public.invoice_share_rate_limits','SELECT')
     OR has_table_privilege('authenticated','public.invoice_share_rate_limits','SELECT')
     OR has_table_privilege('anon','public.invoice_share_rate_limits','INSERT')
     OR has_table_privilege('authenticated','public.invoice_share_rate_limits','INSERT') THEN
    RAISE EXCEPTION 'Client roles must not access invoice_share_rate_limits directly';
  END IF;
  IF has_function_privilege('anon','public.consume_invoice_share_rate_limit(uuid,text,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.consume_invoice_share_rate_limit(uuid,text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Client roles must not execute invoice-share rate-limit RPC';
  END IF;
  IF NOT has_function_privilege('service_role','public.consume_invoice_share_rate_limit(uuid,text,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.record_invoice_share_view(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.increment_invoice_share_download(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute invoice-share RPCs';
  END IF;
END
$acl$;

INSERT INTO public.invoice_share_links (invoice_id, workspace_id, created_by, token_hash)
VALUES
  ('30000000-0000-0000-0000-000000000003','workspace-a','10000000-0000-0000-0000-000000000001',repeat('a',64)),
  ('40000000-0000-0000-0000-000000000004','workspace-b','20000000-0000-0000-0000-000000000002',repeat('b',64));

SET LOCAL ROLE service_role;
DO $rate_limit$
DECLARE
  v_link uuid := (SELECT id FROM public.invoice_share_links WHERE token_hash=repeat('a',64));
  v_other uuid := (SELECT id FROM public.invoice_share_links WHERE token_hash=repeat('b',64));
BEGIN
  IF NOT public.consume_invoice_share_rate_limit(v_link,'public_view',2) THEN
    RAISE EXCEPTION 'First public view request should be allowed';
  END IF;
  IF NOT public.consume_invoice_share_rate_limit(v_link,'public_view',2) THEN
    RAISE EXCEPTION 'Second public view request should be allowed';
  END IF;
  IF public.consume_invoice_share_rate_limit(v_link,'public_view',2) THEN
    RAISE EXCEPTION 'Third public view request should be rate limited';
  END IF;
  IF NOT public.consume_invoice_share_rate_limit(v_link,'track',1) THEN
    RAISE EXCEPTION 'Track action should have an independent rate-limit bucket';
  END IF;
  IF NOT public.consume_invoice_share_rate_limit(v_other,'public_view',1) THEN
    RAISE EXCEPTION 'A separate invoice link should have an independent rate-limit bucket';
  END IF;
  PERFORM public.record_invoice_share_view(v_link);
  PERFORM public.increment_invoice_share_download(v_link);
  IF (SELECT view_count FROM public.invoice_share_links WHERE id=v_link) <> 1 THEN
    RAISE EXCEPTION 'Share view RPC did not increment view_count';
  END IF;
  IF (SELECT download_count FROM public.invoice_share_links WHERE id=v_link) <> 1 THEN
    RAISE EXCEPTION 'Share download RPC did not increment download_count';
  END IF;
END
$rate_limit$;
RESET ROLE;

DO $invalid_action$
BEGIN
  BEGIN
    PERFORM public.consume_invoice_share_rate_limit(
      (SELECT id FROM public.invoice_share_links WHERE token_hash=repeat('a',64)),
      'unknown',
      10
    );
    RAISE EXCEPTION 'Unsupported rate-limit action was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Unsupported rate-limit action was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'Unsupported invoice share rate-limit action' THEN RAISE; END IF;
  END;
END
$invalid_action$;

ROLLBACK;
