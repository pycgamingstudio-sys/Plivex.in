-- Signup trigger must be able to provision the trusted profile/workspace rows.
-- Authenticated direct API inserts remain restricted.
CREATE OR REPLACE FUNCTION public.protect_profile_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
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
END
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  END IF;

  IF _inv.id IS NOT NULL THEN
    UPDATE public.invite_codes SET used_by = NEW.id, used_at = now() WHERE id = _inv.id;
    INSERT INTO public.profiles (id, email, full_name, role, workspace_id, trial_start_at, trial_expires_at)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''), _inv.role, _inv.workspace_id, now(), now() + interval '14 days')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.workspace_members (membership_key, workspace_id, owner_id, user_id, email, role, status)
    VALUES (_inv.workspace_id || ':' || lower(NEW.email), _inv.workspace_id, _inv.owner_id, NEW.id, lower(NEW.email), _inv.role, 'active')
    ON CONFLICT (membership_key) DO UPDATE
      SET user_id = EXCLUDED.user_id, status = 'active',
          revision = public.workspace_members.revision + 1, updated_at = now();
  ELSE
    _ws := 'WS-' || upper(NEW.id::text);
    INSERT INTO public.profiles (id, email, full_name, role, workspace_id, trial_start_at, trial_expires_at)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''), 'admin', _ws, now(), now() + interval '14 days')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.workspace_members (membership_key, workspace_id, owner_id, user_id, email, role, status)
    VALUES (_ws || ':' || lower(NEW.email), _ws, NEW.id, NEW.id, lower(NEW.email), 'admin', 'active')
    ON CONFLICT (membership_key) DO NOTHING;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
