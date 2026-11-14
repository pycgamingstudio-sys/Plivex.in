-- Disposable Supabase-compatible PostgREST fixture for the real subscription handler.
-- All objects and data are created only in the GitHub Actions PostgreSQL service.
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
END
$roles$;
GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
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
GRANT SELECT, UPDATE ON public.subscriptions TO service_role;

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
