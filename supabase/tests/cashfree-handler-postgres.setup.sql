-- Disposable Supabase-compatible PostgREST fixture for the real subscription handler.
-- All objects and data are created only in the GitHub Actions PostgreSQL service.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN CREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN;
  END IF;
END
$roles$;
GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $function$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$function$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL,
  role text NOT NULL
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "integration profile owner read"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL,
  gateway text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  cancel_at_period_end boolean,
  cancellation_requested_at timestamptz,
  updated_at timestamptz
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO service_role;

INSERT INTO public.profiles (id, workspace_id, role)
VALUES ('11111111-1111-4111-8111-111111111111', 'workspace-postgrest', 'admin');

INSERT INTO public.subscriptions (
  id, workspace_id, gateway, provider, status, started_at, expires_at,
  cancel_at_period_end, cancellation_requested_at, updated_at
) VALUES (
  '22222222-2222-4222-8222-222222222222',
  'workspace-postgrest', 'cashfree', 'cashfree', 'active',
  now() - interval '1 day', now() + interval '30 days',
  false, NULL, now() - interval '1 second'
);

NOTIFY pgrst, 'reload schema';

-- Legacy India PayU subscription in the same workspace must remain untouched
-- by the Cashfree-only management handler.
INSERT INTO public.subscriptions (
  id, workspace_id, gateway, provider, status, started_at, expires_at,
  cancel_at_period_end, cancellation_requested_at, updated_at
) VALUES (
  '33333333-3333-4333-8333-333333333333',
  'workspace-postgrest', 'payu', 'payu', 'active',
  now() - interval '2 days', now() + interval '300 days',
  false, NULL, now() - interval '2 seconds'
);
