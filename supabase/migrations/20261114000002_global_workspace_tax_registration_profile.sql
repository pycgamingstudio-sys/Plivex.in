-- Global tax profile foundation. This migration is committed only to global-dev;
-- do not apply to a live Supabase project without the separate deployment approval.
ALTER TABLE public.business_profile
  ADD COLUMN IF NOT EXISTS tax_registration_number text,
  ADD COLUMN IF NOT EXISTS tax_registration_type text,
  ADD COLUMN IF NOT EXISTS tax_registration_status text NOT NULL DEFAULT 'unregistered',
  ADD COLUMN IF NOT EXISTS tax_registration_effective_from date,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.business_profile'::regclass
      AND conname = 'business_profile_tax_registration_status_check'
  ) THEN
    ALTER TABLE public.business_profile
      ADD CONSTRAINT business_profile_tax_registration_status_check
      CHECK (tax_registration_status IN ('unregistered','pending','registered','deregistered'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.business_profile'::regclass
      AND conname = 'business_profile_tax_registration_number_length_check'
  ) THEN
    ALTER TABLE public.business_profile
      ADD CONSTRAINT business_profile_tax_registration_number_length_check
      CHECK (tax_registration_number IS NULL OR length(tax_registration_number) <= 80);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.business_profile'::regclass
      AND conname = 'business_profile_tax_registration_type_length_check'
  ) THEN
    ALTER TABLE public.business_profile
      ADD CONSTRAINT business_profile_tax_registration_type_length_check
      CHECK (tax_registration_type IS NULL OR length(tax_registration_type) <= 32);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.business_profile'::regclass
      AND conname = 'business_profile_tax_jurisdiction_code_length_check'
  ) THEN
    ALTER TABLE public.business_profile
      ADD CONSTRAINT business_profile_tax_jurisdiction_code_length_check
      CHECK (tax_jurisdiction_code IS NULL OR length(tax_jurisdiction_code) <= 32);
  END IF;
END $$;

COMMENT ON COLUMN public.business_profile.tax_registration_number IS
  'Workspace business tax registration identifier; access remains governed by business_profile RLS.';
COMMENT ON COLUMN public.business_profile.tax_registration_type IS
  'Country-specific registration type, e.g. GST, VAT, sales tax, HST or PST.';
COMMENT ON COLUMN public.business_profile.tax_registration_status IS
  'Self-declared workspace status; not independently verified with a tax authority.';
COMMENT ON COLUMN public.business_profile.tax_registration_effective_from IS
  'Effective registration date supplied by the business; used for invoice-date eligibility checks.';
COMMENT ON COLUMN public.business_profile.tax_jurisdiction_code IS
  'Optional registered tax jurisdiction identifier; does not itself establish nexus or place of supply.';
