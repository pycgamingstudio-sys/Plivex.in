-- Part 3: Global-only business data foundation.
-- Additive schema; never reads or alters India public business tables.
begin;

create table if not exists global.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  email text,
  phone text,
  tax_registration_number text,
  billing_address jsonb not null default '{}'::jsonb check (jsonb_typeof(billing_address) = 'object'),
  shipping_address jsonb not null default '{}'::jsonb check (jsonb_typeof(shipping_address) = 'object'),
  notes text,
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index if not exists global_clients_workspace_name_idx on global.clients(workspace_id, lower(name));
create index if not exists global_clients_workspace_status_idx on global.clients(workspace_id, status);

create table if not exists global.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  sku text,
  description text,
  unit text not null default 'unit' check (length(btrim(unit)) between 1 and 32),
  sale_price_minor bigint not null default 0 check (sale_price_minor >= 0),
  purchase_cost_minor bigint not null default 0 check (purchase_cost_minor >= 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  tax_code text,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, sku)
);
create index if not exists global_products_workspace_name_idx on global.products(workspace_id, lower(name));
create index if not exists global_products_workspace_active_idx on global.products(workspace_id, is_active);

create table if not exists global.stock_levels (
  workspace_id uuid not null,
  product_id uuid not null,
  quantity numeric(18,4) not null default 0 check (quantity >= 0),
  reorder_level numeric(18,4) not null default 0 check (reorder_level >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, product_id),
  foreign key (workspace_id, product_id) references global.products(workspace_id, id) on delete cascade
);
create index if not exists global_stock_levels_reorder_idx
  on global.stock_levels(workspace_id, quantity, reorder_level);

create table if not exists global.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  client_id uuid,
  invoice_number text not null check (length(btrim(invoice_number)) between 1 and 64),
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','overdue','cancelled')),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  issue_date date not null default current_date,
  due_date date,
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0),
  notes text,
  invoice_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(invoice_snapshot) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, invoice_number),
  foreign key (workspace_id, client_id) references global.clients(workspace_id, id) on delete restrict,
  check (discount_minor <= subtotal_minor),
  check (amount_paid_minor <= total_minor)
);
create index if not exists global_invoices_workspace_date_idx
  on global.invoices(workspace_id, issue_date desc, created_at desc);
create index if not exists global_invoices_workspace_status_idx
  on global.invoices(workspace_id, status);
create index if not exists global_invoices_workspace_client_idx
  on global.invoices(workspace_id, client_id) where client_id is not null;

create table if not exists global.invoice_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  invoice_id uuid not null,
  product_id uuid,
  description text not null check (length(btrim(description)) between 1 and 500),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 10000),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, invoice_id) references global.invoices(workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_id) references global.products(workspace_id, id) on delete set null
);
create index if not exists global_invoice_items_workspace_invoice_idx
  on global.invoice_items(workspace_id, invoice_id, sort_order);

create table if not exists global.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  invoice_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  payment_date date not null default current_date,
  method text,
  reference text,
  notes text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, invoice_id) references global.invoices(workspace_id, id) on delete restrict
);
create index if not exists global_invoice_payments_workspace_invoice_idx
  on global.invoice_payments(workspace_id, invoice_id, payment_date desc);

create table if not exists global.expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  category text not null check (length(btrim(category)) between 1 and 100),
  vendor text,
  amount_minor bigint not null check (amount_minor > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  expense_date date not null default current_date,
  payment_method text,
  reference text,
  notes text,
  attachment_url text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index if not exists global_expenses_workspace_date_idx
  on global.expenses(workspace_id, expense_date desc, created_at desc);
create index if not exists global_expenses_workspace_category_idx
  on global.expenses(workspace_id, category);

-- All business tables are readable only inside an active Global membership.
-- Browser writes are intentionally withheld until the matching audited
-- Global Edge Function contracts are implemented in a later part.
do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients','products','stock_levels','invoices','invoice_items',
    'invoice_payments','expenses'
  ] loop
    execute format('alter table global.%I enable row level security', table_name);
    execute format('drop policy if exists global_%I_select_member on global.%I', table_name, table_name);
    execute format(
      'create policy global_%I_select_member on global.%I for select to authenticated using (global.is_workspace_member(workspace_id))',
      table_name, table_name
    );
  end loop;
end
$policies$;

grant select on global.clients, global.products, global.stock_levels, global.invoices,
  global.invoice_items, global.invoice_payments, global.expenses to authenticated;
grant all on global.clients, global.products, global.stock_levels, global.invoices,
  global.invoice_items, global.invoice_payments, global.expenses to service_role;
grant usage, select on all sequences in schema global to service_role;

drop trigger if exists global_clients_set_updated_at on global.clients;
create trigger global_clients_set_updated_at before update on global.clients
  for each row execute function global.set_updated_at();
drop trigger if exists global_products_set_updated_at on global.products;
create trigger global_products_set_updated_at before update on global.products
  for each row execute function global.set_updated_at();
drop trigger if exists global_invoices_set_updated_at on global.invoices;
create trigger global_invoices_set_updated_at before update on global.invoices
  for each row execute function global.set_updated_at();
drop trigger if exists global_expenses_set_updated_at on global.expenses;
create trigger global_expenses_set_updated_at before update on global.expenses
  for each row execute function global.set_updated_at();

comment on table global.clients is 'Global-only customer records; workspace-scoped and never shared with India public.clients.';
comment on table global.products is 'Global-only product catalogue; monetary values are integer minor units.';
comment on table global.stock_levels is 'Global-only current stock balance; writes require audited server-side operations.';
comment on table global.invoices is 'Global-only invoice headers; tax and totals are stored in currency minor units.';
comment on table global.invoice_items is 'Global-only invoice lines with composite workspace foreign keys.';
comment on table global.invoice_payments is 'Global-only invoice payment records; payment writes require server-side reconciliation.';
comment on table global.expenses is 'Global-only business expenses; monetary values are integer minor units.';

commit;
