-- Self-service country reset foundation.
-- Business records are removed only inside the authenticated owner's own workspace.
-- The operation is one PostgreSQL transaction; any exception rolls the entire reset back.

alter table public.profiles
  add column if not exists country_code text,
  add column if not exists locale_code text;

create schema if not exists private;

create table if not exists private.country_reset_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_changed_at timestamptz not null,
  last_country_code text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.country_reset_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  old_country_code text not null,
  new_country_code text not null,
  old_locale_code text not null,
  new_locale_code text not null,
  old_currency_code text not null,
  new_currency_code text not null,
  old_workspace_id text,
  new_workspace_id text not null,
  reason text,
  changed_at timestamptz not null default now()
);

alter table private.country_reset_state enable row level security;
alter table private.country_reset_events enable row level security;
revoke all on private.country_reset_state from public, anon, authenticated;
revoke all on private.country_reset_events from public, anon, authenticated;

-- Preserve historical country-change audit rows when their old workspace is deleted.
alter table global.workspace_country_change_events
  alter column workspace_id drop not null;
alter table global.workspace_country_change_events
  drop constraint if exists workspace_country_change_events_workspace_id_fkey;
alter table global.workspace_country_change_events
  add constraint workspace_country_change_events_workspace_id_fkey
  foreign key (workspace_id) references global.workspaces(id) on delete set null;

create or replace function public.reset_workspace_country_atomic(
  p_user_id uuid,
  p_country_code text,
  p_locale_code text,
  p_currency_code text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, global, private
as $function$
declare
  v_email text;
  v_full_name text;
  v_profile public.profiles%rowtype;
  v_global_membership global.workspace_members%rowtype;
  v_global_workspace global.workspaces%rowtype;
  v_from_country text;
  v_from_locale text;
  v_from_currency text;
  v_old_workspace_id text;
  v_new_workspace_id text;
  v_new_global_workspace_id uuid;
  v_now timestamptz := clock_timestamp();
  v_workspace_name text;
  v_last_changed timestamptz;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'user_required');
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

  -- Serialize all resets and workspace bootstrap operations for this Auth identity.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select lower(u.email),
         coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1))
    into v_email, v_full_name
  from auth.users u
  where u.id = p_user_id
  for update;

  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_user_not_found');
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = p_user_id
  for update;

  select * into v_global_membership
  from global.workspace_members m
  where m.user_id = p_user_id and m.status = 'active'
  order by m.created_at asc
  limit 1
  for update;

  if v_global_membership.id is not null then
    if v_profile.workspace_id is not null then
      return jsonb_build_object('ok', false, 'reason', 'conflicting_workspace_memberships');
    end if;
    if v_global_membership.role <> 'owner' then
      return jsonb_build_object('ok', false, 'reason', 'workspace_owner_required');
    end if;
    select * into v_global_workspace
    from global.workspaces w
    where w.id = v_global_membership.workspace_id
    for update;
    if v_global_workspace.id is null then
      return jsonb_build_object('ok', false, 'reason', 'workspace_not_found');
    end if;
    v_from_country := v_global_workspace.country_code;
    v_from_locale := v_global_workspace.locale_code;
    v_from_currency := v_global_workspace.currency_code;
    v_old_workspace_id := v_global_workspace.id::text;
  elsif v_profile.id is not null and v_profile.workspace_id is not null then
    if coalesce(v_profile.country_code, 'IN') <> 'IN' then
      return jsonb_build_object('ok', false, 'reason', 'profile_edition_mismatch');
    end if;
    if v_profile.role <> 'admin' then
      return jsonb_build_object('ok', false, 'reason', 'workspace_owner_required');
    end if;
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = v_profile.workspace_id
        and m.user_id = p_user_id
        and m.owner_id = p_user_id
        and m.role = 'admin'
        and m.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'workspace_owner_required');
    end if;
    v_from_country := coalesce(v_profile.country_code, 'IN');
    v_from_locale := coalesce(v_profile.locale_code, 'en-IN');
    v_from_currency := case v_from_country
      when 'IN' then 'INR' when 'US' then 'USD' when 'GB' then 'GBP'
      when 'AE' then 'AED' when 'CA' then 'CAD' when 'AU' then 'AUD'
      when 'SG' then 'SGD' else null end;
    v_old_workspace_id := v_profile.workspace_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'active_owner_workspace_required');
  end if;

  if v_from_country = p_country_code then
    return jsonb_build_object('ok', false, 'reason', 'same_country');
  end if;

  -- Do not silently take over stale/inactive memberships or a second tenant.
  if v_global_membership.id is null and exists (
    select 1 from global.workspace_members m where m.user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'legacy_global_membership_requires_review');
  end if;

  select s.last_changed_at into v_last_changed
  from private.country_reset_state s
  where s.user_id = p_user_id
  for update;
  if v_last_changed is not null and v_last_changed > v_now - interval '30 days' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'cooldown_active',
      'retry_after', v_last_changed + interval '30 days'
    );
  end if;

  -- All authorization and policy checks are complete. From this point onward,
  -- any error raises and PostgreSQL rolls back every deletion and insertion.

  if v_global_membership.id is not null then
    -- Delete restrictive children first; workspace-owned rows then cascade.
    delete from global.invoice_payments where workspace_id = v_global_workspace.id;
    delete from global.stock_movements where workspace_id = v_global_workspace.id;
    delete from global.invoice_items where workspace_id = v_global_workspace.id;
    delete from global.invoices where workspace_id = v_global_workspace.id;
    delete from global.clients where workspace_id = v_global_workspace.id;
    delete from global.expenses where workspace_id = v_global_workspace.id;
    delete from global.products where workspace_id = v_global_workspace.id;
    delete from global.stock_levels where workspace_id = v_global_workspace.id;
    delete from global.business_profiles where workspace_id = v_global_workspace.id;
    delete from global.workspace_members where workspace_id = v_global_workspace.id;
    delete from global.workspaces where id = v_global_workspace.id;
  else
    -- Delete tenant-owned business data only. Keep Auth profile, subscription and
    -- payment history; invoice children/share/reminder rows cascade from invoices.
    delete from public.invoices where workspace_id = v_old_workspace_id;
    delete from public.expenses where workspace_id = v_old_workspace_id;
    delete from public.clients where workspace_id = v_old_workspace_id;
    delete from public.leads where workspace_id = v_old_workspace_id;
    delete from public.quotations where workspace_id = v_old_workspace_id;
    delete from public.services where workspace_id = v_old_workspace_id;
    delete from public.stock where workspace_id = v_old_workspace_id;
    delete from public.business_profile where workspace_id = v_old_workspace_id;
    delete from public.activity_logs where workspace_id = v_old_workspace_id;
    delete from public.staff_activity where workspace_id = v_old_workspace_id;
    delete from public.assistant_actions where workspace_id = v_old_workspace_id;
    delete from public.assistant_action_batches where workspace_id = v_old_workspace_id;
    delete from public.invoice_counters where workspace_id = v_old_workspace_id;
    delete from public.plan_rejections where workspace_id = v_old_workspace_id;
    delete from public.usage_counters where workspace_id = v_old_workspace_id;
    delete from public.workspace_members where workspace_id = v_old_workspace_id;
  end if;

  if p_country_code = 'IN' then
    v_new_workspace_id := 'WS-' || upper(gen_random_uuid()::text);
    insert into public.profiles(id, email, full_name, role, workspace_id, country_code, locale_code, updated_at)
    values (p_user_id, v_email, v_full_name, 'admin', v_new_workspace_id, 'IN', p_locale_code, v_now)
    on conflict (id) do update set
      email = excluded.email,
      role = 'admin',
      workspace_id = excluded.workspace_id,
      country_code = excluded.country_code,
      locale_code = excluded.locale_code,
      updated_at = excluded.updated_at;

    insert into public.workspace_members(
      membership_key, workspace_id, owner_id, user_id, name, email, role, status, activated_at, updated_at
    ) values (
      v_new_workspace_id || ':' || v_email, v_new_workspace_id, p_user_id, p_user_id,
      v_full_name, v_email, 'admin', 'active', v_now, v_now
    );

    insert into public.business_profile(workspace_id, name)
    values (v_new_workspace_id, v_full_name);
  else
    v_workspace_name := left(coalesce(nullif(btrim(v_full_name), ''), split_part(v_email, '@', 1) || ' Workspace'), 160);
    insert into global.workspaces(name, country_code, locale_code, currency_code, created_by)
    values (v_workspace_name, p_country_code, p_locale_code, p_currency_code, p_user_id)
    returning id into v_new_global_workspace_id;
    v_new_workspace_id := v_new_global_workspace_id::text;

    insert into global.workspace_members(workspace_id, user_id, role, status)
    values (v_new_global_workspace_id, p_user_id, 'owner', 'active');

    insert into global.user_profiles(user_id, email, full_name, default_workspace_id)
    values (p_user_id, v_email, left(coalesce(v_full_name, ''), 160), v_new_global_workspace_id)
    on conflict (user_id) do update set
      email = excluded.email,
      full_name = case when excluded.full_name <> '' then excluded.full_name else global.user_profiles.full_name end,
      default_workspace_id = excluded.default_workspace_id,
      updated_at = v_now;

    insert into global.business_profiles(
      workspace_id, legal_name, display_name, email, country_code, locale_code, currency_code
    ) values (
      v_new_global_workspace_id, v_workspace_name, v_workspace_name, v_email,
      p_country_code, p_locale_code, p_currency_code
    );

    insert into public.profiles(id, email, full_name, role, workspace_id, country_code, locale_code, updated_at)
    values (p_user_id, v_email, v_full_name, 'admin', null, p_country_code, p_locale_code, v_now)
    on conflict (id) do update set
      email = excluded.email,
      role = 'admin',
      workspace_id = null,
      country_code = excluded.country_code,
      locale_code = excluded.locale_code,
      updated_at = excluded.updated_at;
  end if;

  -- Keep the subscription and payment ledger attached to the same account.
  update public.subscriptions
    set workspace_id = v_new_workspace_id, updated_at = v_now
  where user_id = p_user_id;
  update public.payment_logs
    set workspace_id = v_new_workspace_id, updated_at = v_now
  where user_id = p_user_id or workspace_id = v_old_workspace_id;

  insert into private.country_reset_events(
    user_id, old_country_code, new_country_code, old_locale_code, new_locale_code,
    old_currency_code, new_currency_code, old_workspace_id, new_workspace_id, reason, changed_at
  ) values (
    p_user_id, v_from_country, p_country_code, v_from_locale, p_locale_code,
    coalesce(v_from_currency, 'UNKNOWN'), p_currency_code,
    v_old_workspace_id, v_new_workspace_id, left(nullif(btrim(p_reason), ''), 500), v_now
  );

  insert into private.country_reset_state(user_id, last_changed_at, last_country_code, updated_at)
  values (p_user_id, v_now, p_country_code, v_now)
  on conflict (user_id) do update set
    last_changed_at = excluded.last_changed_at,
    last_country_code = excluded.last_country_code,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'country_code', p_country_code,
    'locale_code', p_locale_code,
    'currency_code', p_currency_code,
    'workspace_id', v_new_workspace_id,
    'cooldown_days', 30
  );
end;
$function$;

revoke all on function public.reset_workspace_country_atomic(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.reset_workspace_country_atomic(uuid,text,text,text,text) to service_role;
