-- PLIVEX ONE: canonical country-aware settings for the single public workspace identity.
begin;

create table if not exists public.workspace_settings (
  workspace_id text primary key,
  country_code text not null,
  locale_code text not null,
  currency_code text not null,
  workspace_type text not null default 'business'
    check (workspace_type in ('freelancer','business')),
  optional_features text[] not null default '{}'::text[],
  phone_country_code text,
  phone_number text,
  settings_version integer not null default 1 check (settings_version > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_settings_country_currency_check check (
    (country_code = 'IN' and currency_code = 'INR' and locale_code in ('en-IN','hi-IN'))
    or (country_code = 'US' and currency_code = 'USD' and locale_code in ('en-US','es-US'))
    or (country_code = 'GB' and currency_code = 'GBP' and locale_code = 'en-GB')
    or (country_code = 'AE' and currency_code = 'AED' and locale_code in ('en-AE','ar-AE'))
    or (country_code = 'CA' and currency_code = 'CAD' and locale_code in ('en-CA','fr-CA'))
    or (country_code = 'AU' and currency_code = 'AUD' and locale_code = 'en-AU')
    or (country_code = 'SG' and currency_code = 'SGD' and locale_code in ('en-SG','zh-SG','ms-SG','ta-SG'))
  ),
  constraint workspace_settings_phone_country_code_check check (
    phone_country_code is null or phone_country_code ~ '^\+[1-9][0-9]{0,3}$'
  ),
  constraint workspace_settings_phone_number_check check (
    phone_number is null or length(phone_number) between 3 and 32
  ),
  constraint workspace_settings_optional_features_check check (
    optional_features <@ array['expenses','crm','leads','inventoryWorkspace','reports']::text[]
  )
);

create index if not exists workspace_settings_country_idx
  on public.workspace_settings(country_code, currency_code);

alter table public.workspace_settings enable row level security;

drop policy if exists "workspace settings read members" on public.workspace_settings;
create policy "workspace settings read members"
  on public.workspace_settings for select to authenticated
  using (has_ws_role(workspace_id, array['admin'::app_role,'manager'::app_role,'employee'::app_role,'accountant'::app_role,'storekeeper'::app_role]));

drop policy if exists "workspace settings insert admins" on public.workspace_settings;
create policy "workspace settings insert admins"
  on public.workspace_settings for insert to authenticated
  with check (has_ws_role(workspace_id, array['admin'::app_role]));

drop policy if exists "workspace settings update admins" on public.workspace_settings;
create policy "workspace settings update admins"
  on public.workspace_settings for update to authenticated
  using (has_ws_role(workspace_id, array['admin'::app_role]))
  with check (has_ws_role(workspace_id, array['admin'::app_role]));

grant select, insert, update on public.workspace_settings to authenticated;
grant all on public.workspace_settings to service_role;

-- Backfill only explicitly country-stamped workspaces. Never infer India from missing data.
insert into public.workspace_settings (
  workspace_id, country_code, locale_code, currency_code, workspace_type, created_at, updated_at
)
select
  bp.workspace_id,
  bp.country_code,
  bp.locale_code,
  case bp.country_code
    when 'IN' then 'INR'
    when 'US' then 'USD'
    when 'GB' then 'GBP'
    when 'AE' then 'AED'
    when 'CA' then 'CAD'
    when 'AU' then 'AUD'
    when 'SG' then 'SGD'
  end,
  'business',
  now(),
  now()
from public.business_profile bp
where bp.country_code is not null
  and bp.locale_code is not null
on conflict (workspace_id) do nothing;

comment on table public.workspace_settings is
  'PLIVEX ONE canonical country, currency, primary work profile and optional-feature settings for a public workspace. Country is explicitly selected; no IP or locale inference.';
comment on column public.workspace_settings.optional_features is
  'Optional dashboard/navigation modules. Removing an item never deletes its business records.';
comment on column public.workspace_settings.workspace_type is
  'Primary workspace profile selected during first-time onboarding: freelancer or business.';

commit;
