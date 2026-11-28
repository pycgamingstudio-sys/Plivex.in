-- Main Workspace India compliance records: TDS, IRN/e-invoice and e-way bill.
-- This migration adds internal records and provider handoff metadata only.
-- It does not call GSTN/IRP, file returns, or store provider credentials.
begin;

alter table public.invoice_items add column if not exists hsn_sac_code text;
alter table public.invoice_items add column if not exists unit_code text not null default 'OTH';
alter table public.invoice_items add constraint invoice_items_hsn_sac_code_format check (hsn_sac_code is null or hsn_sac_code ~ '^[0-9]{4,8} (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  source_type text not null check (source_type in ('vendor_payment','professional_fee','rent','contractor','commission','other')),
  source_reference text,
  deductee_name text not null check (length(btrim(deductee_name)) between 1 and 200),
  deductee_pan text not null default '' check (deductee_pan = '' or deductee_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  section_code text not null check (section_code ~ '^19[0-9A-Z]{2,3}$'),
  deduction_date date not null,
  payment_date date,
  currency_code text not null default 'INR' check (currency_code = 'INR'),
  gross_amount_minor bigint not null check (gross_amount_minor > 0 and gross_amount_minor <= 9000000000000000),
  tds_rate_bps integer not null check (tds_rate_bps between 0 and 10000),
  tds_amount_minor bigint not null check (tds_amount_minor >= 0 and tds_amount_minor <= gross_amount_minor),
  net_amount_minor bigint generated always as (gross_amount_minor - tds_amount_minor) stored,
  financial_year text not null check (financial_year ~ '^20[0-9]{2}-[0-9]{2}$'),
  quarter text not null check (quarter in ('Q1','Q2','Q3','Q4')),
  status text not null default 'draft' check (status in ('draft','deducted','deposited','filed','reversed')),
  challan_number text,
  challan_date date,
  bsr_code text,
  deposit_reference text,
  notes text,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,idempotency_key),
  check (tds_amount_minor = round(gross_amount_minor::numeric * tds_rate_bps / 10000)::bigint),
  check ((status in ('deposited','filed') and challan_number is not null and challan_date is not null) or status not in ('deposited','filed'))
);
create index if not exists workspace_tds_entries_period_idx
  on public.workspace_tds_entries(workspace_id,financial_year,quarter,deduction_date desc);
create index if not exists workspace_tds_entries_status_idx
  on public.workspace_tds_entries(workspace_id,status,deduction_date desc);

create table if not exists public.workspace_einvoice_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_number text not null,
  status text not null default 'draft' check (status in ('draft','ready','submitted','acknowledged','rejected','cancelled')),
  provider text,
  provider_request_id text,
  irn text,
  acknowledgement_number text,
  acknowledgement_date timestamptz,
  signed_invoice jsonb,
  signed_qr_code text,
  request_payload jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors)='array'),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,invoice_id),
  unique (workspace_id,idempotency_key),
  check (status <> 'acknowledged' or (irn is not null and acknowledgement_number is not null and acknowledgement_date is not null))
);
create unique index if not exists workspace_einvoice_irn_unique_idx
  on public.workspace_einvoice_records(irn) where irn is not null;
create index if not exists workspace_einvoice_status_idx
  on public.workspace_einvoice_records(workspace_id,status,created_at desc);

create table if not exists public.workspace_eway_bill_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_number text not null,
  status text not null default 'draft' check (status in ('draft','ready','submitted','generated','rejected','cancelled','expired')),
  document_type text not null default 'INV' check (document_type in ('INV','CHL','BIL','BOE','OTH')),
  document_number text not null,
  document_date date not null,
  distance_km integer check (distance_km between 1 and 4000),
  transporter_id text,
  transporter_name text,
  transport_mode text check (transport_mode in ('road','rail','air','ship')),
  vehicle_number text,
  eway_bill_number text,
  generated_at timestamptz,
  valid_until timestamptz,
  request_payload jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors)='array'),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,idempotency_key),
  check (status <> 'generated' or (eway_bill_number is not null and generated_at is not null and valid_until is not null))
);
create unique index if not exists workspace_eway_bill_number_unique_idx
  on public.workspace_eway_bill_records(eway_bill_number) where eway_bill_number is not null;
create unique index if not exists workspace_eway_bill_invoice_active_idx
  on public.workspace_eway_bill_records(workspace_id,invoice_id)
  where status in ('ready','submitted','generated');
create index if not exists workspace_eway_bill_status_idx
  on public.workspace_eway_bill_records(workspace_id,status,created_at desc);

create table if not exists public.workspace_compliance_provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  provider_type text not null check (provider_type in ('gst_irp','gstn','tds')),
  provider_name text not null check (length(btrim(provider_name)) between 1 and 120),
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  status text not null default 'not_configured' check (status in ('not_configured','awaiting_credentials','configured','sandbox_verified','live_verified','disabled')),
  secret_reference text check (secret_reference is null or secret_reference ~ '^[A-Z][A-Z0-9_]{2,100}$'),
  external_account_reference text,
  metadata jsonb not null default '{}'::jsonb,
  configured_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,provider_type,environment)
);

alter table public.workspace_tds_entries enable row level security;
alter table public.workspace_einvoice_records enable row level security;
alter table public.workspace_eway_bill_records enable row level security;
alter table public.workspace_compliance_provider_connections enable row level security;
revoke all on public.workspace_tds_entries,public.workspace_einvoice_records,public.workspace_eway_bill_records,public.workspace_compliance_provider_connections from public,anon,authenticated;
grant all on public.workspace_tds_entries,public.workspace_einvoice_records,public.workspace_eway_bill_records,public.workspace_compliance_provider_connections to service_role;

alter table public.workspace_tds_entries add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.workspace_einvoice_records add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.workspace_eway_bill_records add column if not exists updated_by uuid references auth.users(id) on delete set null;

create or replace function public.audit_workspace_india_compliance_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row jsonb := to_jsonb(new);
  v_actor uuid;
  v_action text;
  v_entity_type text;
  v_metadata jsonb;
begin
  v_actor := coalesce(
    nullif(v_row->>'updated_by','')::uuid,
    nullif(v_row->>'created_by','')::uuid,
    nullif(v_row->>'configured_by','')::uuid
  );
  if v_actor is null then
    raise exception using errcode='23502',message='Compliance audit actor is required';
  end if;
  v_entity_type := case tg_table_name
    when 'workspace_tds_entries' then 'tds_entry'
    when 'workspace_einvoice_records' then 'einvoice_record'
    when 'workspace_eway_bill_records' then 'eway_bill_record'
    else 'compliance_provider_connection'
  end;
  v_action := 'compliance.'||replace(v_entity_type,'_','.')||'.'||lower(tg_op);
  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'status',v_row->>'status',
    'section_code',v_row->>'section_code',
    'provider_type',v_row->>'provider_type',
    'environment',v_row->>'environment'
  ));
  insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_row->>'workspace_id',v_actor,v_action,v_entity_type,v_row->>'id',v_metadata);
  return new;
end;
$function$;

revoke all on function public.audit_workspace_india_compliance_change() from public,anon,authenticated;

drop trigger if exists workspace_tds_entries_audit on public.workspace_tds_entries;
create trigger workspace_tds_entries_audit after insert or update on public.workspace_tds_entries
for each row execute function public.audit_workspace_india_compliance_change();
drop trigger if exists workspace_einvoice_records_audit on public.workspace_einvoice_records;
create trigger workspace_einvoice_records_audit after insert or update on public.workspace_einvoice_records
for each row execute function public.audit_workspace_india_compliance_change();
drop trigger if exists workspace_eway_bill_records_audit on public.workspace_eway_bill_records;
create trigger workspace_eway_bill_records_audit after insert or update on public.workspace_eway_bill_records
for each row execute function public.audit_workspace_india_compliance_change();
drop trigger if exists workspace_compliance_provider_connections_audit on public.workspace_compliance_provider_connections;
create trigger workspace_compliance_provider_connections_audit after insert or update on public.workspace_compliance_provider_connections
for each row execute function public.audit_workspace_india_compliance_change();

commit;
) not valid;
alter table public.invoice_items add constraint invoice_items_unit_code_format check (unit_code ~ '^[A-Z0-9]{2,8} (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  source_type text not null check (source_type in ('vendor_payment','professional_fee','rent','contractor','commission','other')),
  source_reference text,
  deductee_name text not null check (length(btrim(deductee_name)) between 1 and 200),
  deductee_pan text not null default '' check (deductee_pan = '' or deductee_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  section_code text not null check (section_code ~ '^19[0-9A-Z]{2,3}$'),
  deduction_date date not null,
  payment_date date,
  currency_code text not null default 'INR' check (currency_code = 'INR'),
  gross_amount_minor bigint not null check (gross_amount_minor > 0 and gross_amount_minor <= 9000000000000000),
  tds_rate_bps integer not null check (tds_rate_bps between 0 and 10000),
  tds_amount_minor bigint not null check (tds_amount_minor >= 0 and tds_amount_minor <= gross_amount_minor),
  net_amount_minor bigint generated always as (gross_amount_minor - tds_amount_minor) stored,
  financial_year text not null check (financial_year ~ '^20[0-9]{2}-[0-9]{2}$'),
  quarter text not null check (quarter in ('Q1','Q2','Q3','Q4')),
  status text not null default 'draft' check (status in ('draft','deducted','deposited','filed','reversed')),
  challan_number text,
  challan_date date,
  bsr_code text,
  deposit_reference text,
  notes text,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,idempotency_key),
  check (tds_amount_minor = round(gross_amount_minor::numeric * tds_rate_bps / 10000)::bigint),
  check ((status in ('deposited','filed') and challan_number is not null and challan_date is not null) or status not in ('deposited','filed'))
);
create index if not exists workspace_tds_entries_period_idx
  on public.workspace_tds_entries(workspace_id,financial_year,quarter,deduction_date desc);
create index if not exists workspace_tds_entries_status_idx
  on public.workspace_tds_entries(workspace_id,status,deduction_date desc);

create table if not exists public.workspace_einvoice_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_number text not null,
  status text not null default 'draft' check (status in ('draft','ready','submitted','acknowledged','rejected','cancelled')),
  provider text,
  provider_request_id text,
  irn text,
  acknowledgement_number text,
  acknowledgement_date timestamptz,
  signed_invoice jsonb,
  signed_qr_code text,
  request_payload jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors)='array'),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,invoice_id),
  unique (workspace_id,idempotency_key),
  check (status <> 'acknowledged' or (irn is not null and acknowledgement_number is not null and acknowledgement_date is not null))
);
create unique index if not exists workspace_einvoice_irn_unique_idx
  on public.workspace_einvoice_records(irn) where irn is not null;
create index if not exists workspace_einvoice_status_idx
  on public.workspace_einvoice_records(workspace_id,status,created_at desc);

create table if not exists public.workspace_eway_bill_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_number text not null,
  status text not null default 'draft' check (status in ('draft','ready','submitted','generated','rejected','cancelled','expired')),
  document_type text not null default 'INV' check (document_type in ('INV','CHL','BIL','BOE','OTH')),
  document_number text not null,
  document_date date not null,
  distance_km integer check (distance_km between 1 and 4000),
  transporter_id text,
  transporter_name text,
  transport_mode text check (transport_mode in ('road','rail','air','ship')),
  vehicle_number text,
  eway_bill_number text,
  generated_at timestamptz,
  valid_until timestamptz,
  request_payload jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors)='array'),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,idempotency_key),
  check (status <> 'generated' or (eway_bill_number is not null and generated_at is not null and valid_until is not null))
);
create unique index if not exists workspace_eway_bill_number_unique_idx
  on public.workspace_eway_bill_records(eway_bill_number) where eway_bill_number is not null;
create unique index if not exists workspace_eway_bill_invoice_active_idx
  on public.workspace_eway_bill_records(workspace_id,invoice_id)
  where status in ('ready','submitted','generated');
create index if not exists workspace_eway_bill_status_idx
  on public.workspace_eway_bill_records(workspace_id,status,created_at desc);

create table if not exists public.workspace_compliance_provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  provider_type text not null check (provider_type in ('gst_irp','gstn','tds')),
  provider_name text not null check (length(btrim(provider_name)) between 1 and 120),
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  status text not null default 'not_configured' check (status in ('not_configured','awaiting_credentials','configured','sandbox_verified','live_verified','disabled')),
  secret_reference text check (secret_reference is null or secret_reference ~ '^[A-Z][A-Z0-9_]{2,100}$'),
  external_account_reference text,
  metadata jsonb not null default '{}'::jsonb,
  configured_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,provider_type,environment)
);

alter table public.workspace_tds_entries enable row level security;
alter table public.workspace_einvoice_records enable row level security;
alter table public.workspace_eway_bill_records enable row level security;
alter table public.workspace_compliance_provider_connections enable row level security;
revoke all on public.workspace_tds_entries,public.workspace_einvoice_records,public.workspace_eway_bill_records,public.workspace_compliance_provider_connections from public,anon,authenticated;
grant all on public.workspace_tds_entries,public.workspace_einvoice_records,public.workspace_eway_bill_records,public.workspace_compliance_provider_connections to service_role;

commit;
) not valid;

create table if not exists public.workspace_tds_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  source_type text not null check (source_type in ('vendor_payment','professional_fee','rent','contractor','commission','other')),
  source_reference text,
  deductee_name text not null check (length(btrim(deductee_name)) between 1 and 200),
  deductee_pan text not null default '' check (deductee_pan = '' or deductee_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  section_code text not null check (section_code ~ '^19[0-9A-Z]{2,3}$'),
  deduction_date date not null,
  payment_date date,
  currency_code text not null default 'INR' check (currency_code = 'INR'),
  gross_amount_minor bigint not null check (gross_amount_minor > 0 and gross_amount_minor <= 9000000000000000),
  tds_rate_bps integer not null check (tds_rate_bps between 0 and 10000),
  tds_amount_minor bigint not null check (tds_amount_minor >= 0 and tds_amount_minor <= gross_amount_minor),
  net_amount_minor bigint generated always as (gross_amount_minor - tds_amount_minor) stored,
  financial_year text not null check (financial_year ~ '^20[0-9]{2}-[0-9]{2}$'),
  quarter text not null check (quarter in ('Q1','Q2','Q3','Q4')),
  status text not null default 'draft' check (status in ('draft','deducted','deposited','filed','reversed')),
  challan_number text,
  challan_date date,
  bsr_code text,
  deposit_reference text,
  notes text,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,idempotency_key),
  check (tds_amount_minor = round(gross_amount_minor::numeric * tds_rate_bps / 10000)::bigint),
  check ((status in ('deposited','filed') and challan_number is not null and challan_date is not null) or status not in ('deposited','filed'))
);
create index if not exists workspace_tds_entries_period_idx
  on public.workspace_tds_entries(workspace_id,financial_year,quarter,deduction_date desc);
create index if not exists workspace_tds_entries_status_idx
  on public.workspace_tds_entries(workspace_id,status,deduction_date desc);

create table if not exists public.workspace_einvoice_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_number text not null,
  status text not null default 'draft' check (status in ('draft','ready','submitted','acknowledged','rejected','cancelled')),
  provider text,
  provider_request_id text,
  irn text,
  acknowledgement_number text,
  acknowledgement_date timestamptz,
  signed_invoice jsonb,
  signed_qr_code text,
  request_payload jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors)='array'),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,invoice_id),
  unique (workspace_id,idempotency_key),
  check (status <> 'acknowledged' or (irn is not null and acknowledgement_number is not null and acknowledgement_date is not null))
);
create unique index if not exists workspace_einvoice_irn_unique_idx
  on public.workspace_einvoice_records(irn) where irn is not null;
create index if not exists workspace_einvoice_status_idx
  on public.workspace_einvoice_records(workspace_id,status,created_at desc);

create table if not exists public.workspace_eway_bill_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_number text not null,
  status text not null default 'draft' check (status in ('draft','ready','submitted','generated','rejected','cancelled','expired')),
  document_type text not null default 'INV' check (document_type in ('INV','CHL','BIL','BOE','OTH')),
  document_number text not null,
  document_date date not null,
  distance_km integer check (distance_km between 1 and 4000),
  transporter_id text,
  transporter_name text,
  transport_mode text check (transport_mode in ('road','rail','air','ship')),
  vehicle_number text,
  eway_bill_number text,
  generated_at timestamptz,
  valid_until timestamptz,
  request_payload jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors)='array'),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,idempotency_key),
  check (status <> 'generated' or (eway_bill_number is not null and generated_at is not null and valid_until is not null))
);
create unique index if not exists workspace_eway_bill_number_unique_idx
  on public.workspace_eway_bill_records(eway_bill_number) where eway_bill_number is not null;
create unique index if not exists workspace_eway_bill_invoice_active_idx
  on public.workspace_eway_bill_records(workspace_id,invoice_id)
  where status in ('ready','submitted','generated');
create index if not exists workspace_eway_bill_status_idx
  on public.workspace_eway_bill_records(workspace_id,status,created_at desc);

create table if not exists public.workspace_compliance_provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  provider_type text not null check (provider_type in ('gst_irp','gstn','tds')),
  provider_name text not null check (length(btrim(provider_name)) between 1 and 120),
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  status text not null default 'not_configured' check (status in ('not_configured','awaiting_credentials','configured','sandbox_verified','live_verified','disabled')),
  secret_reference text check (secret_reference is null or secret_reference ~ '^[A-Z][A-Z0-9_]{2,100}$'),
  external_account_reference text,
  metadata jsonb not null default '{}'::jsonb,
  configured_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,provider_type,environment)
);

alter table public.workspace_tds_entries enable row level security;
alter table public.workspace_einvoice_records enable row level security;
alter table public.workspace_eway_bill_records enable row level security;
alter table public.workspace_compliance_provider_connections enable row level security;
revoke all on public.workspace_tds_entries,public.workspace_einvoice_records,public.workspace_eway_bill_records,public.workspace_compliance_provider_connections from public,anon,authenticated;
grant all on public.workspace_tds_entries,public.workspace_einvoice_records,public.workspace_eway_bill_records,public.workspace_compliance_provider_connections to service_role;

commit;
