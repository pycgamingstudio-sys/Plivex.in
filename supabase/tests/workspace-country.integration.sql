-- Isolated PostgreSQL integration fixture for the Part 2 workspace country migration.
BEGIN;
CREATE TABLE public.business_profile (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id text NOT NULL UNIQUE,
  name text
);
INSERT INTO public.business_profile (workspace_id, name) VALUES ('legacy-workspace', 'Legacy');

\ir ../migrations/202611130006_workspace_country_identity.sql
\ir ../migrations/202611130006_workspace_country_identity.sql

DO $test$
DECLARE
  v_country text;
  v_locale text;
BEGIN
  SELECT country_code, locale_code INTO v_country, v_locale
  FROM public.business_profile WHERE workspace_id = 'legacy-workspace';
  IF v_country IS NOT NULL OR v_locale IS NOT NULL THEN
    RAISE EXCEPTION 'Existing workspace must remain unset until explicit confirmation';
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
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.business_profile (workspace_id, country_code, locale_code)
    VALUES ('missing-locale-workspace', 'US', NULL);
    RAISE EXCEPTION 'Country without locale was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.business_profile (workspace_id, country_code, locale_code)
    VALUES ('missing-country-workspace', NULL, 'en-US');
    RAISE EXCEPTION 'Locale without country was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;
ROLLBACK;
