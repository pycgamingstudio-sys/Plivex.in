-- Part 2 integration fixture using the actual Supabase business_profile shape and
-- its current workspace-role RLS contract. Runs only in the disposable CI database.
BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO authenticated;

CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'employee', 'storekeeper', 'accountant');

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  workspace_id text,
  role public.app_role NOT NULL
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles
  FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));
GRANT SELECT ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.has_ws_role(_ws text, _roles public.app_role[])
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND workspace_id = _ws
      AND role = ANY(_roles)
  )
$fn$;
GRANT EXECUTE ON FUNCTION public.has_ws_role(text, public.app_role[]) TO authenticated;

-- Match the actual public.business_profile columns relevant to this feature.
CREATE TABLE public.business_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL UNIQUE,
  name text,
  email text,
  phone text,
  gstin text,
  address text,
  logo_url text,
  upi_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bp read" ON public.business_profile
  FOR SELECT TO authenticated
  USING (has_ws_role(workspace_id, ARRAY['admin','manager','employee','storekeeper','accountant']::public.app_role[]));
CREATE POLICY "bp insert" ON public.business_profile
  FOR INSERT TO authenticated
  WITH CHECK (has_ws_role(workspace_id, ARRAY['admin']::public.app_role[]));
CREATE POLICY "bp update" ON public.business_profile
  FOR UPDATE TO authenticated
  USING (has_ws_role(workspace_id, ARRAY['admin']::public.app_role[]))
  WITH CHECK (has_ws_role(workspace_id, ARRAY['admin']::public.app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.business_profile TO authenticated;

INSERT INTO public.profiles (id, workspace_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', 'workspace-a', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'workspace-a', 'employee'),
  ('00000000-0000-0000-0000-000000000003', 'workspace-b', 'admin');
INSERT INTO public.business_profile (workspace_id, name) VALUES
  ('workspace-a', 'Legacy A'),
  ('workspace-b', 'Private B');

\\ir ../migrations/202611130006_workspace_country_identity.sql
\\ir ../migrations/202611130006_workspace_country_identity.sql

DO $constraints$
DECLARE
  v_country text;
  v_locale text;
  v_name text;
BEGIN
  SELECT country_code, locale_code, name INTO v_country, v_locale, v_name
  FROM public.business_profile WHERE workspace_id = 'workspace-a';
  IF v_country IS NOT NULL OR v_locale IS NOT NULL OR v_name <> 'Legacy A' THEN
    RAISE EXCEPTION 'Migration changed existing business profile data or defaulted country';
  END IF;

  INSERT INTO public.business_profile (workspace_id, country_code, locale_code) VALUES
    ('in-workspace', 'IN', 'en-IN'),
    ('us-workspace', 'US', 'en-US'),
    ('gb-workspace', 'GB', 'en-GB'),
    ('ae-workspace', 'AE', 'ar-AE'),
    ('ca-workspace', 'CA', 'fr-CA'),
    ('au-workspace', 'AU', 'en-AU'),
    ('sg-workspace', 'SG', 'ta-SG');

  BEGIN
    INSERT INTO public.business_profile (workspace_id, country_code, locale_code)
    VALUES ('unsupported-workspace', 'ZZ', 'en-ZZ');
    RAISE EXCEPTION 'Unsupported country/locale pair was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_profile (workspace_id, country_code, locale_code)
    VALUES ('missing-locale-workspace', 'US', NULL);
    RAISE EXCEPTION 'Country without locale was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_profile (workspace_id, country_code, locale_code)
    VALUES ('missing-country-workspace', NULL, 'en-US');
    RAISE EXCEPTION 'Locale without country was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$constraints$;

-- An authenticated admin can read/update only their own workspace profile.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;
DO $admin_rls$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.business_profile;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Admin must see only their own workspace profile; got %', v_count; END IF;

  UPDATE public.business_profile SET country_code = 'IN', locale_code = 'en-IN'
  WHERE workspace_id = 'workspace-a';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Workspace admin should update own business profile'; END IF;

  UPDATE public.business_profile SET name = 'tampered'
  WHERE workspace_id = 'workspace-b';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-workspace update unexpectedly affected rows'; END IF;
END
$admin_rls$;
RESET ROLE;

-- An authenticated employee can read but cannot update or insert a business profile.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE authenticated;
DO $employee_rls$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.business_profile;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Employee must see only their own workspace profile'; END IF;

  UPDATE public.business_profile SET country_code = 'US', locale_code = 'en-US'
  WHERE workspace_id = 'workspace-a';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Non-admin employee unexpectedly updated business profile'; END IF;

  BEGIN
    INSERT INTO public.business_profile (workspace_id, country_code, locale_code)
    VALUES ('employee-created-workspace', 'US', 'en-US');
    RAISE EXCEPTION 'Non-admin employee unexpectedly inserted business profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$employee_rls$;
RESET ROLE;

ROLLBACK;
