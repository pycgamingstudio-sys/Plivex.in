-- Plivex Global isolation foundation.
-- Additive only: creates a private schema and does not alter India public objects.
-- Keep this migration unapplied until Chat 2/3 testing and Chat 4 approval.

begin;

create schema if not exists global;

revoke all on schema global from public, anon, authenticated;
grant usage on schema global to service_role;

create or replace function global.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists global.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  locale_code text not null check (length(locale_code) between 2 and 16),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists global.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '' check (length(full_name) <= 160),
  avatar_url text,
  default_workspace_id uuid references global.workspaces(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists global.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','employee','accountant','viewer')),
  status text not null default 'active' check (status in ('invited','active','suspended')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists global_workspace_members_user_idx
  on global.workspace_members(user_id, status);
create index if not exists global_workspace_members_workspace_idx
  on global.workspace_members(workspace_id, status);

create table if not exists global.business_profiles (
  workspace_id uuid primary key references global.workspaces(id) on delete cascade,
  legal_name text not null default '' check (length(legal_name) <= 200),
  display_name text not null default '' check (length(display_name) <= 200),
  email text,
  phone text,
  address text,
  tax_registration_number text,
  tax_registration_type text,
  tax_registration_status text not null default 'unregistered'
    check (tax_registration_status in ('unregistered','pending','registered','deregistered')),
  tax_jurisdiction_code text,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  locale_code text not null check (length(locale_code) between 2 and 16),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function global.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, global
as $$
  select exists (
    select 1
    from global.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$$;

create or replace function global.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, global
as $$
  select exists (
    select 1
    from global.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner','admin')
  );
$$;

revoke all on function global.is_workspace_member(uuid) from public, anon;
revoke all on function global.is_workspace_admin(uuid) from public, anon;
grant execute on function global.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function global.is_workspace_admin(uuid) to authenticated, service_role;

alter table global.workspaces enable row level security;
alter table global.user_profiles enable row level security;
alter table global.workspace_members enable row level security;
alter table global.business_profiles enable row level security;

drop policy if exists global_workspace_select_member on global.workspaces;
create policy global_workspace_select_member on global.workspaces
  for select to authenticated
  using (global.is_workspace_member(id));

drop policy if exists global_profile_select_self on global.user_profiles;
create policy global_profile_select_self on global.user_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists global_member_select_workspace on global.workspace_members;
create policy global_member_select_workspace on global.workspace_members
  for select to authenticated
  using (global.is_workspace_member(workspace_id));

drop policy if exists global_business_profile_select_member on global.business_profiles;
create policy global_business_profile_select_member on global.business_profiles
  for select to authenticated
  using (global.is_workspace_member(workspace_id));

drop policy if exists global_business_profile_update_admin on global.business_profiles;
create policy global_business_profile_update_admin on global.business_profiles
  for update to authenticated
  using (global.is_workspace_admin(workspace_id))
  with check (global.is_workspace_admin(workspace_id));

-- No authenticated INSERT/DELETE policies are intentionally provided for
-- profiles, workspaces, or memberships. Provisioning/invites must go through
-- separately authenticated Global Edge Functions using service_role.
grant select on global.workspaces, global.user_profiles, global.workspace_members,
  global.business_profiles to authenticated;
grant update on global.business_profiles to authenticated;
grant all on all tables in schema global to service_role;
grant usage, select on all sequences in schema global to service_role;

comment on schema global is
  'Plivex Global edition data. Never reuse India public-schema records here.';
comment on table global.user_profiles is
  'Global-only profile; India public.profiles never grants Global roles or access.';
comment on table global.workspace_members is
  'Global-only workspace authorization membership.';
comment on function global.is_workspace_member(uuid) is
  'RLS helper: checks active membership in the Global edition only.';

commit;
