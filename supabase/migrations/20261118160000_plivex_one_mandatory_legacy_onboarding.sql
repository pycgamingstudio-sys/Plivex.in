-- PLIVEX ONE: force legacy workspaces through the same verified onboarding once.
begin;

alter table public.workspace_settings
  add column if not exists onboarding_version smallint not null default 0
    check (onboarding_version between 0 and 1);

alter table public.workspace_settings
  add column if not exists migration_status text not null default 'legacy_pending'
    check (migration_status in ('legacy_pending','review_required','ready'));

alter table public.workspace_settings
  add column if not exists onboarding_completed_at timestamptz;

alter table public.workspace_settings
  add column if not exists legacy_review_required boolean not null default false;

-- Rows that predate this rollout are intentionally pending, even when they
-- already contain country and work-profile values. Monetary records are not
-- rewritten here; their stored currency remains historical truth.
update public.workspace_settings
set onboarding_version = 0,
    migration_status = case when legacy_review_required then 'review_required' else 'legacy_pending' end,
    onboarding_completed_at = null,
    updated_at = now()
where onboarding_version < 1;

create index if not exists workspace_settings_onboarding_status_idx
  on public.workspace_settings(migration_status, onboarding_version);

comment on column public.workspace_settings.onboarding_version is
  'Version of the mandatory single-Workspace onboarding completed by the workspace owner. Existing workspaces are version 0 until explicitly reviewed.';
comment on column public.workspace_settings.migration_status is
  'legacy_pending blocks app access until owner review; review_required blocks access for ambiguous legacy mappings; ready permits normal access.';
comment on column public.workspace_settings.legacy_review_required is
  'Set when historical country or data mapping is ambiguous. Never infer or rewrite historical currency to clear this flag.';

-- Preserve the old Global workspace identity as a migration source while moving
-- its current profile, warehouse and chart-of-accounts records to the one
-- canonical public workspace. No Global transaction tables currently contain
-- rows; they remain intact as an archival source until a later verified release.
alter table public.workspace_settings
  alter column workspace_type drop not null;

alter table public.workspace_settings
  add column if not exists legacy_global_workspace_id uuid;

create unique index if not exists workspace_settings_legacy_global_workspace_uidx
  on public.workspace_settings(legacy_global_workspace_id)
  where legacy_global_workspace_id is not null;

do $plivex$
declare
  v_unmapped integer;
begin
  select count(*) into v_unmapped
  from global.workspaces w
  left join global.user_profiles g on g.default_workspace_id = w.id
  left join public.profiles p on p.id = g.user_id
  where p.id is null or p.workspace_id is null;

  if v_unmapped > 0 then
    raise exception 'PLIVEX ONE migration stopped: % legacy Global workspace(s) have no verified canonical owner mapping', v_unmapped;
  end if;
end
$plivex$;

-- Seed canonical settings from the explicitly stored legacy Global workspace
-- country/currency. The workspace owner must still confirm country, locale,
-- work type and feature choices in the new onboarding before access is restored.
insert into public.workspace_settings (
  workspace_id, country_code, locale_code, currency_code, workspace_type,
  optional_features, created_by, onboarding_version, migration_status,
  legacy_review_required, legacy_global_workspace_id, updated_at
)
select
  p.workspace_id, w.country_code, w.locale_code, w.currency_code, null,
  '{}'::text[], g.user_id, 0, 'legacy_pending', true, w.id, now()
from global.workspaces w
join global.user_profiles g on g.default_workspace_id = w.id
join public.profiles p on p.id = g.user_id
where w.country_code in ('IN','US','GB','AE','CA','AU','SG')
  and (
    (w.country_code='IN' and w.currency_code='INR' and w.locale_code in ('en-IN','hi-IN'))
    or (w.country_code='US' and w.currency_code='USD' and w.locale_code in ('en-US','es-US'))
    or (w.country_code='GB' and w.currency_code='GBP' and w.locale_code='en-GB')
    or (w.country_code='AE' and w.currency_code='AED' and w.locale_code in ('en-AE','ar-AE'))
    or (w.country_code='CA' and w.currency_code='CAD' and w.locale_code in ('en-CA','fr-CA'))
    or (w.country_code='AU' and w.currency_code='AUD' and w.locale_code='en-AU')
    or (w.country_code='SG' and w.currency_code='SGD' and w.locale_code in ('en-SG','zh-SG','ms-SG','ta-SG'))
  )
on conflict (workspace_id) do update
set legacy_global_workspace_id = excluded.legacy_global_workspace_id,
    migration_status = case
      when public.workspace_settings.country_code <> excluded.country_code
        or public.workspace_settings.currency_code <> excluded.currency_code
      then 'review_required'
      else 'legacy_pending'
    end,
    onboarding_version = 0,
    legacy_review_required = (
      public.workspace_settings.country_code <> excluded.country_code
      or public.workspace_settings.currency_code <> excluded.currency_code
    ),
    onboarding_completed_at = null,
    updated_at = now();

-- Carry over the legacy Global business profile without overwriting any
-- non-empty canonical values already present in the public workspace.
insert into public.business_profile (
  workspace_id, name, email, phone, address, country_code, locale_code,
  tax_registration_number, tax_registration_type, tax_registration_status,
  tax_jurisdiction_code, tax_registration_effective_from, created_at, updated_at
)
select
  p.workspace_id,
  coalesce(nullif(bp.display_name,''), nullif(bp.legal_name,''), w.name),
  bp.email, bp.phone, bp.address, w.country_code, w.locale_code,
  bp.tax_registration_number, bp.tax_registration_type, bp.tax_registration_status,
  bp.tax_jurisdiction_code, bp.tax_registration_effective_from, bp.created_at, now()
from global.business_profiles bp
join global.workspaces w on w.id = bp.workspace_id
join global.user_profiles g on g.default_workspace_id = w.id
join public.profiles p on p.id = g.user_id
on conflict (workspace_id) do update
set name = coalesce(nullif(public.business_profile.name,''), excluded.name),
    email = coalesce(public.business_profile.email, excluded.email),
    phone = coalesce(public.business_profile.phone, excluded.phone),
    address = coalesce(public.business_profile.address, excluded.address),
    country_code = coalesce(public.business_profile.country_code, excluded.country_code),
    locale_code = coalesce(public.business_profile.locale_code, excluded.locale_code),
    tax_registration_number = coalesce(public.business_profile.tax_registration_number, excluded.tax_registration_number),
    tax_registration_type = coalesce(public.business_profile.tax_registration_type, excluded.tax_registration_type),
    tax_registration_status = coalesce(public.business_profile.tax_registration_status, excluded.tax_registration_status),
    tax_jurisdiction_code = coalesce(public.business_profile.tax_jurisdiction_code, excluded.tax_jurisdiction_code),
    tax_registration_effective_from = coalesce(public.business_profile.tax_registration_effective_from, excluded.tax_registration_effective_from),
    updated_at = now();

-- Preserve Global warehouse identifiers and attributes in the canonical
-- workspace. Address JSON is retained as text rather than reinterpreted.
insert into public.warehouses (
  id, workspace_id, code, name, address, is_default, is_active, created_at, updated_at
)
select
  gw.id, p.workspace_id, gw.code, gw.name,
  case when gw.address is null then null else gw.address::text end,
  gw.is_default, gw.is_active, gw.created_at, now()
from global.warehouses gw
join global.workspaces w on w.id = gw.workspace_id
join global.user_profiles g on g.default_workspace_id = w.id
join public.profiles p on p.id = g.user_id
where not exists (
  select 1 from public.warehouses pw
  where pw.workspace_id = p.workspace_id and pw.code = gw.code
)
on conflict do nothing;

-- The legacy chart of accounts has no canonical equivalent yet. Copy it to a
-- first-class public table with original row IDs and an explicit source key.
create table if not exists public.accounting_accounts (
  id uuid primary key,
  workspace_id text not null,
  legacy_global_workspace_id uuid not null,
  code text not null,
  name text not null,
  account_type text not null,
  normal_balance text not null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounting_accounts_workspace_code_key unique (workspace_id, code),
  constraint accounting_accounts_normal_balance_check check (normal_balance in ('debit','credit'))
);

alter table public.accounting_accounts enable row level security;
drop policy if exists "accounting accounts read workspace members" on public.accounting_accounts;
create policy "accounting accounts read workspace members"
  on public.accounting_accounts for select to authenticated
  using (has_ws_role(workspace_id, array['admin'::app_role,'manager'::app_role,'employee'::app_role,'accountant'::app_role,'storekeeper'::app_role]));

revoke all on public.accounting_accounts from anon, authenticated;
grant select on public.accounting_accounts to authenticated;
grant all on public.accounting_accounts to service_role;

insert into public.accounting_accounts (
  id, workspace_id, legacy_global_workspace_id, code, name, account_type,
  normal_balance, is_system, is_active, source_created_at, source_updated_at
)
select
  a.id, p.workspace_id, a.workspace_id, a.code, a.name, a.account_type,
  a.normal_balance, a.is_system, a.is_active, a.created_at, a.updated_at
from global.accounting_accounts a
join global.workspaces w on w.id = a.workspace_id
join global.user_profiles g on g.default_workspace_id = w.id
join public.profiles p on p.id = g.user_id
on conflict (id) do nothing;


commit;
