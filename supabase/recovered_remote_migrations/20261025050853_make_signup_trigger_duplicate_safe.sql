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
      AND (used_by IS NULL OR used_by = NEW.id)
      AND (expires_at IS NULL OR expires_at > now())
      AND (email IS NULL OR lower(email) = lower(NEW.email))
    FOR UPDATE;

    IF _inv.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVITE_CODE_INVALID_OR_EXPIRED';
    END IF;

    UPDATE public.invite_codes
      SET used_by = NEW.id, used_at = COALESCE(used_at, now()), updated_at = now()
      WHERE id = _inv.id AND used_by IS NULL;

    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM public.invite_codes WHERE id = _inv.id AND used_by = NEW.id
    ) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVITE_CODE_ALREADY_USED';
    END IF;

    INSERT INTO public.profiles (id, email, full_name, role, workspace_id, trial_start_at, trial_expires_at)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''), _inv.role, _inv.workspace_id, NULL, NULL)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.workspace_members
      (membership_key, workspace_id, owner_id, user_id, email, role, status, accepted_at, activated_at)
    VALUES (_inv.workspace_id || ':' || lower(NEW.email), _inv.workspace_id, _inv.owner_id, NEW.id, lower(NEW.email), _inv.role, 'active', now(), now())
    ON CONFLICT (membership_key) DO UPDATE
      SET user_id = EXCLUDED.user_id, status = 'active', accepted_at = COALESCE(public.workspace_members.accepted_at, now()),
          activated_at = COALESCE(public.workspace_members.activated_at, now()),
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
