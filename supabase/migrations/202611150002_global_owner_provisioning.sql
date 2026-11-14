-- Global-only owner provisioning and auth-context RPCs.
-- Public wrappers are executable by service_role only; all business data remains in global schema.
begin;

alter table global.user_profiles
  add column if not exists phone text;

create or replace function public.global_get_auth_context(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_profile jsonb;
  v_membership jsonb;
  v_workspace jsonb;
  v_workspace_id uuid;
begin
  if p_user_id is null then
    return jsonb_build_object('profile', null, 'membership', null, 'workspace', null);
  end if;

  select jsonb_build_object(
    'user_id', p.user_id,
    'email', p.email,
    'full_name', p.full_name,
    'avatar_url', p.avatar_url,
    'phone', p.phone,
    'default_workspace_id', p.default_workspace_id,
    'created_at', p.created_at
  )
  into v_profile
  from global.user_profiles p
  where p.user_id = p_user_id;

  select m.workspace_id, jsonb_build_object(
    'workspace_id', m.workspace_id,
    'role', m.role,
    'status', m.status
  )
  into v_workspace_id, v_membership
  from global.workspace_members m
  left join global.user_profiles p on p.user_id = m.user_id
  where m.user_id = p_user_id
    and m.status = 'active'
  order by (m.workspace_id = p.default_workspace_id) desc nulls last, m.created_at asc
  limit 1;

  if v_workspace_id is not null then
    select jsonb_build_object(
      'id', w.id,
      'name', w.name,
      'country_code', w.country_code,
      'locale_code', w.locale_code,
      'currency_code', w.currency_code
    )
    into v_workspace
    from global.workspaces w
    where w.id = v_workspace_id;
  end if;

  return jsonb_build_object(
    'profile', v_profile,
    'membership', v_membership,
    'workspace', v_workspace
  );
end;
$function$;

create or replace function public.global_provision_owner_workspace(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_country_code text,
  p_locale_code text,
  p_currency_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_email text;
  v_name text;
  v_workspace_id uuid;
  v_role text;
  v_status text;
  v_workspace global.workspaces%rowtype;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'user_required');
  end if;

  select lower(btrim(coalesce(nullif(btrim(p_email), ''), u.email)))
    into v_email
  from auth.users u
  where u.id = p_user_id;

  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_user_not_found');
  end if;

  if not (
    (p_country_code = 'IN' and p_currency_code = 'INR' and p_locale_code in ('en-IN','hi-IN'))
    or (p_country_code = 'US' and p_currency_code = 'USD' and p_locale_code in ('en-US','es-US'))
    or (p_country_code = 'GB' and p_currency_code = 'GBP' and p_locale_code = 'en-GB')
    or (p_country_code = 'AE' and p_currency_code = 'AED' and p_locale_code in ('en-AE','ar-AE'))
    or (p_country_code = 'CA' and p_currency_code = 'CAD' and p_locale_code in ('en-CA','fr-CA'))
    or (p_country_code = 'AU' and p_currency_code = 'AUD' and p_locale_code = 'en-AU')
    or (p_country_code = 'SG' and p_currency_code = 'SGD' and p_locale_code in ('en-SG','zh-SG','ms-SG','ta-SG'))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_country_locale_currency');
  end if;

  -- Serialize concurrent sign-in/bootstrap requests for the same Auth identity.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select m.workspace_id, m.role, m.status
    into v_workspace_id, v_role, v_status
  from global.workspace_members m
  where m.user_id = p_user_id
  order by (m.status = 'active') desc, m.created_at asc
  limit 1
  for update;

  if v_workspace_id is not null and v_status = 'active' then
    insert into global.user_profiles(user_id, email, full_name, default_workspace_id)
    values (p_user_id, v_email, left(coalesce(nullif(btrim(p_full_name), ''), ''), 160), v_workspace_id)
    on conflict (user_id) do update
      set email = excluded.email,
          full_name = case when excluded.full_name <> '' then excluded.full_name else global.user_profiles.full_name end,
          default_workspace_id = excluded.default_workspace_id,
          updated_at = now();

    select * into v_workspace from global.workspaces where id = v_workspace_id;
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'workspace_id', v_workspace_id,
      'role', v_role,
      'status', v_status,
      'country_code', v_workspace.country_code,
      'locale_code', v_workspace.locale_code,
      'currency_code', v_workspace.currency_code
    );
  end if;

  if v_workspace_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'membership_requires_review', 'status', v_status);
  end if;

  v_name := left(coalesce(nullif(btrim(p_full_name), ''), split_part(v_email, '@', 1) || ' Workspace'), 160);

  insert into global.workspaces(name, country_code, locale_code, currency_code, created_by)
  values (v_name, p_country_code, p_locale_code, p_currency_code, p_user_id)
  returning id into v_workspace_id;

  insert into global.workspace_members(workspace_id, user_id, role, status)
  values (v_workspace_id, p_user_id, 'owner', 'active');

  insert into global.user_profiles(user_id, email, full_name, default_workspace_id)
  values (p_user_id, v_email, left(coalesce(nullif(btrim(p_full_name), ''), ''), 160), v_workspace_id)
  on conflict (user_id) do update
    set email = excluded.email,
        full_name = case when excluded.full_name <> '' then excluded.full_name else global.user_profiles.full_name end,
        default_workspace_id = excluded.default_workspace_id,
        updated_at = now();

  insert into global.business_profiles(
    workspace_id, legal_name, display_name, email,
    country_code, locale_code, currency_code
  )
  values (v_workspace_id, v_name, v_name, v_email, p_country_code, p_locale_code, p_currency_code);

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'workspace_id', v_workspace_id,
    'role', 'owner',
    'status', 'active',
    'country_code', p_country_code,
    'locale_code', p_locale_code,
    'currency_code', p_currency_code
  );
end;
$function$;

create or replace function public.global_update_user_profile(
  p_user_id uuid,
  p_full_name text,
  p_avatar_url text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_profile global.user_profiles%rowtype;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'user_required');
  end if;
  update global.user_profiles
  set full_name = case when p_full_name is null then full_name else left(btrim(p_full_name), 160) end,
      avatar_url = case when p_avatar_url is null then avatar_url else p_avatar_url end,
      phone = case when p_phone is null then phone else left(btrim(p_phone), 40) end,
      updated_at = now()
  where user_id = p_user_id
  returning * into v_profile;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'global_profile_not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_profile.user_id,
    'full_name', v_profile.full_name,
    'avatar_url', v_profile.avatar_url,
    'phone', v_profile.phone
  );
end;
$function$;

revoke all on function public.global_get_auth_context(uuid) from public, anon, authenticated;
revoke all on function public.global_provision_owner_workspace(uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.global_update_user_profile(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.global_get_auth_context(uuid) to service_role;
grant execute on function public.global_provision_owner_workspace(uuid,text,text,text,text,text) to service_role;
grant execute on function public.global_update_user_profile(uuid,text,text,text) to service_role;

comment on function public.global_get_auth_context(uuid) is
  'Service-role-only read of a Global user profile and active Global workspace membership.';
comment on function public.global_provision_owner_workspace(uuid,text,text,text,text,text) is
  'Service-role-only, serialized Global owner workspace provisioning. Never reads India public profiles.';
comment on function public.global_update_user_profile(uuid,text,text,text) is
  'Service-role-only update of a Global user profile.';

commit;
