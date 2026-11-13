-- Disposable fixture for the exact assistant batch RLS optimization migration.
-- The migration itself names the prerequisite table, owner column and policy.
BEGIN;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END
$roles$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE public.assistant_action_batches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.assistant_action_batches ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.assistant_action_batches TO anon, authenticated;
CREATE POLICY "Users read own assistant action batches"
  ON public.assistant_action_batches FOR SELECT TO authenticated
  USING (user_id = auth.uid());
INSERT INTO public.assistant_action_batches (id,user_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');

\ir ../migrations/20261114000001_optimize_assistant_batch_rls_policy.sql

DO $policy$
DECLARE v_qual text;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual
  FROM pg_policy WHERE polname='Users read own assistant action batches'
    AND polrelid='public.assistant_action_batches'::regclass;
  IF v_qual IS NULL OR position('auth.uid()' IN v_qual)=0 THEN
    RAISE EXCEPTION 'Optimized ownership predicate missing: %',v_qual;
  END IF;
  IF position('SELECT' IN upper(v_qual))=0 THEN
    RAISE EXCEPTION 'auth.uid() is not wrapped in a scalar SELECT: %',v_qual;
  END IF;
END
$policy$;
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
DO $ownership$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.assistant_action_batches;
  IF v_count<>1 THEN RAISE EXCEPTION 'RLS returned % rows for owner, expected 1',v_count; END IF;
END
$ownership$;
RESET ROLE;
RESET request.jwt.claim.sub;
ROLLBACK;
