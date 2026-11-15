-- Part 7: country changes for Global workspaces.
-- This updates only the active workspace identity and business profile.
-- Existing invoices and their immutable invoice_snapshot values are untouched.

begin;

create table if not exists global.workspace_country_change_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete restrict,
  changed_by uuid not null references auth.users(id) on delete restrict,
  from_country_code text not null,
  to_country_code text not null,
  from_locale_code text not null,
  to_locale_code text not null,
  from_currency_code text not null,
  to_currency_code text not null,
  reason text,
  changed_at timestamptz not null default now(),
  check (reason is null or length(reason) <= 500)
);

create index if not exists global_workspace_country_events_workspace_time_idx
  on global.workspace_country_change_events(workspace_id, changed_at desc);

alter table global.workspace_country_change_events enable row level security;
revoke all on global.workspace_country_change_events from public, anon, authenticated;
grant all on global.workspace_country_change_events to service_role;

create or replace function public.global_change_workspace_country(
  p_user_id uuid,
  p_workspace_id uuid,
  p_country_code text,
  p_locale_code text,
  p_currency_code text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_workspace global.workspaces%rowtype;
  v_role text;
  v_expected_currency text;
begin
  if p_user_id is null or p_workspace_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  end if;

  -- India uses the separate India data plane. A Global workspace must not
  -- switch editions until a dedicated cross-schema data migration exists.
  if p_country_code = 'IN' then
    return jsonb_build_object('ok', false, 'reason', 'india_workspace_migration_required');
  end if;

  v_expected_currency := case p_country_code
    when 'IN' then 'INR'
    when 'US' then 'USD'
    when 'GB' then 'GBP'
    when 'AE' then 'AED'
    when 'CA' then 'CAD'
    when 'AU' then 'AUD'
    when 'SG' then 'SGD'
    else null
  end;

  if v_expected_currency is null or p_currency_code is distinct from v_expected_currency then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_country_currency');
  end if;

  if not (
    (p_country_code = 'IN' and p_locale_code in ('en-IN','hi-IN')) or
    (p_country_code = 'US' and p_locale_code in ('en-US','es-US')) or
    (p_country_code = 'GB' and p_locale_code = 'en-GB') or
    (p_country_code = 'AE' and p_locale_code in ('en-AE','ar-AE')) or
    (p_country_code = 'CA' and p_locale_code in ('en-CA','fr-CA')) or
    (p_country_code = 'AU' and p_locale_code = 'en-AU') or
    (p_country_code = 'SG' and p_locale_code in ('en-SG','zh-SG','ms-SG','ta-SG'))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_country_locale');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 71027));

  select wm.role into v_role
  from global.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_user_id
    and wm.status = 'active'
  for update;

  if coalesce(v_role, '') not in ('owner','admin') then
    return jsonb_build_object('ok', false, 'reason', 'workspace_admin_required');
  end if;

  select * into v_workspace
  from global.workspaces
  where id = p_workspace_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'workspace_not_found');
  end if;

  if v_workspace.country_code = p_country_code
     and v_workspace.locale_code = p_locale_code
     and v_workspace.currency_code = p_currency_code then
    return jsonb_build_object('ok', true, 'changed', false,
      'country_code', v_workspace.country_code,
      'locale_code', v_workspace.locale_code,
      'currency_code', v_workspace.currency_code);
  end if;

  update global.workspaces
  set country_code = p_country_code,
      locale_code = p_locale_code,
      currency_code = p_currency_code,
      updated_at = now()
  where id = p_workspace_id;

  insert into global.business_profiles (
    workspace_id, country_code, locale_code, currency_code
  ) values (
    p_workspace_id, p_country_code, p_locale_code, p_currency_code
  )
  on conflict (workspace_id) do update
    set country_code = excluded.country_code,
        locale_code = excluded.locale_code,
        currency_code = excluded.currency_code,
        updated_at = now();

  insert into global.workspace_country_change_events (
    workspace_id, changed_by, from_country_code, to_country_code,
    from_locale_code, to_locale_code, from_currency_code, to_currency_code, reason
  ) values (
    p_workspace_id, p_user_id, v_workspace.country_code, p_country_code,
    v_workspace.locale_code, p_locale_code, v_workspace.currency_code, p_currency_code,
    nullif(btrim(p_reason), '')
  );

  return jsonb_build_object('ok', true, 'changed', true,
    'country_code', p_country_code,
    'locale_code', p_locale_code,
    'currency_code', p_currency_code);
end;
$function$;

revoke all on function public.global_change_workspace_country(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.global_change_workspace_country(uuid,uuid,text,text,text,text) to service_role;

commit;
