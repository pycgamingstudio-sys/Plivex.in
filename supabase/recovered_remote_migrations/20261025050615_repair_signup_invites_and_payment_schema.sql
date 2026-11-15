-- Add columns used by the current server-side signup/team/payment code.
ALTER TABLE public.invite_codes
  ADD COLUMN IF NOT EXISTS used_by uuid,
  ADD COLUMN IF NOT EXISTS used_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.payment_logs
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS hash_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

CREATE INDEX IF NOT EXISTS invite_codes_used_by_idx ON public.invite_codes(used_by);
CREATE INDEX IF NOT EXISTS subscriptions_user_status_expiry_idx ON public.subscriptions(user_id, status, expires_at);

-- Trusted auth.users trigger may create a profile; direct self-insert cannot assign privileged fields.
CREATE OR REPLACE FUNCTION public.protect_profile_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND auth.uid() = NEW.id THEN
      NEW.role := 'employee'::public.app_role;
      NEW.workspace_id := NULL;
      NEW.trial_start_at := NULL;
      NEW.trial_expires_at := NULL;
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.trial_start_at IS DISTINCT FROM OLD.trial_start_at
     OR NEW.trial_expires_at IS DISTINCT FROM OLD.trial_expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='PROFILE_SERVER_FIELDS_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  _code text := NULLIF(trim(NEW.raw_user_meta_data->>'invite_code'), '');
  _inv public.invite_codes%ROWTYPE;
  _ws text;
BEGIN
  IF _code IS NOT NULL THEN
    SELECT * INTO _inv
    FROM public.invite_codes
    WHERE code = _code
      AND used_by IS NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND (email IS NULL OR lower(email) = lower(NEW.email))
    FOR UPDATE;

    IF _inv.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVITE_CODE_INVALID_OR_EXPIRED';
    END IF;

    UPDATE public.invite_codes
      SET used_by = NEW.id, used_at = now(), updated_at = now()
      WHERE id = _inv.id AND used_by IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVITE_CODE_ALREADY_USED';
    END IF;

    INSERT INTO public.profiles (id, email, full_name, role, workspace_id, trial_start_at, trial_expires_at)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''), _inv.role, _inv.workspace_id, NULL, NULL)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.workspace_members
      (membership_key, workspace_id, owner_id, user_id, email, role, status, accepted_at, activated_at)
    VALUES (_inv.workspace_id || ':' || lower(NEW.email), _inv.workspace_id, _inv.owner_id, NEW.id, lower(NEW.email), _inv.role, 'active', now(), now())
    ON CONFLICT (membership_key) DO UPDATE
      SET user_id = EXCLUDED.user_id, status = 'active', accepted_at = now(), activated_at = now(),
          revision = public.workspace_members.revision + 1, updated_at = now();
  ELSE
    _ws := 'WS-' || upper(NEW.id::text);

    INSERT INTO public.profiles (id, email, full_name, role, workspace_id, trial_start_at, trial_expires_at)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''), 'admin', _ws, now(), now() + interval '14 days')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.workspace_members
      (membership_key, workspace_id, owner_id, user_id, email, role, status, accepted_at, activated_at)
    VALUES (_ws || ':' || lower(NEW.email), _ws, NEW.id, NEW.id, lower(NEW.email), 'admin', 'active', now(), now())
    ON CONFLICT (membership_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_plivex ON auth.users;
CREATE TRIGGER on_auth_user_created_plivex
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
