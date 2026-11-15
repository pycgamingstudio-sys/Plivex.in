-- Part 2: persist an explicitly selected workspace country and locale.
-- Existing rows remain NULL until a user explicitly confirms a choice.
ALTER TABLE public.business_profile
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS locale_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.business_profile'::regclass
      AND conname = 'business_profile_supported_country_locale_check'
  ) THEN
    ALTER TABLE public.business_profile
      ADD CONSTRAINT business_profile_supported_country_locale_check
      CHECK (
        (country_code IS NULL AND locale_code IS NULL)
        OR (
          country_code IS NOT NULL AND locale_code IS NOT NULL AND (
            (country_code = 'IN' AND locale_code IN ('en-IN','hi-IN'))
            OR (country_code = 'US' AND locale_code IN ('en-US','es-US'))
            OR (country_code = 'GB' AND locale_code = 'en-GB')
            OR (country_code = 'AE' AND locale_code IN ('en-AE','ar-AE'))
            OR (country_code = 'CA' AND locale_code IN ('en-CA','fr-CA'))
            OR (country_code = 'AU' AND locale_code = 'en-AU')
            OR (country_code = 'SG' AND locale_code IN ('en-SG','zh-SG','ms-SG','ta-SG'))
          )
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.business_profile.country_code IS
  'Explicitly confirmed workspace business-country identity; not tax jurisdiction proof.';
COMMENT ON COLUMN public.business_profile.locale_code IS
  'Explicit workspace display locale for number/currency formatting; no conversion.';
