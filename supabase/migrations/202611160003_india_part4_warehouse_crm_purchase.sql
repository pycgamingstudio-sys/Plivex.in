-- Part 4 India edition: additive CRM and multi-warehouse/purchasing foundation.
-- Existing India clients, leads, stock and invoices remain intact.
begin;

alter table public.leads
  add column if not exists company text,
  add column if not exists email text,
  add column if not exists source text,
  add column if not exists score smallint not null default 0 check(score between 0 and 100),
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists leads_workspace_followup_idx
  on public.leads(workspace_id,next_follow_up_at) where next_follow_up_at is not null;

create unique index if not exists leads_workspace_id_uidx on public.leads(workspace_id,id);

create table if not exists public.lead_activities (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 lead_id uuid not null,
 activity_type text not null check(activity_type in ('note','call','email','meeting','stage_change','follow_up')),
 body text not null check(length(btrim(body)) between 1 and 4000),
 due_at timestamptz,
 completed_at timestamptz,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,lead_id) references public.leads(workspace_id,id) on delete cascade
);
create index if not exists lead_activities_workspace_lead_idx on public.lead_activities(workspace_id,lead_id,created_at desc);
alter table public.lead_activities enable row level security;
drop policy if exists "lead activities read" on public.lead_activities;
create policy "lead activities read" on public.lead_activities for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'employee'::app_role]));
drop policy if exists "lead activities insert" on public.lead_activities;
create policy "lead activities insert" on public.lead_activities for insert to authenticated
 with check(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role]) and created_by=auth.uid());

create table if not exists public.warehouses (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 code text not null check(length(btrim(code)) between 1 and 32),
 name text not null check(length(btrim(name)) between 1 and 160),
 address text,
 is_default boolean not null default false,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,id),
 unique(workspace_id,code)
);
create unique index if not exists warehouses_one_default_per_workspace_uidx
 on public.warehouses(workspace_id) where is_default;
alter table public.stock add column if not exists warehouse_id uuid;

insert into public.warehouses(workspace_id,code,name,is_default)
select distinct s.workspace_id,'MAIN','Main Warehouse',true
from public.stock s
where not exists(select 1 from public.warehouses w where w.workspace_id=s.workspace_id)
on conflict(workspace_id,code) do nothing;

update public.stock s set warehouse_id=w.id
from public.warehouses w
where s.workspace_id=w.workspace_id and w.is_default and s.warehouse_id is null;

alter table public.stock alter column warehouse_id set not null;
do $$
begin
 if not exists(select 1 from pg_constraint where conname='stock_workspace_warehouse_fk') then
  alter table public.stock add constraint stock_workspace_warehouse_fk
   foreign key(workspace_id,warehouse_id) references public.warehouses(workspace_id,id) on delete restrict;
 end if;
end $$;
create index if not exists stock_workspace_warehouse_idx on public.stock(workspace_id,warehouse_id);

create unique index if not exists stock_workspace_id_uidx on public.stock(workspace_id,id);

create table if not exists public.stock_movements (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 warehouse_id uuid not null,
 stock_id uuid not null,
 movement_type text not null check(movement_type in ('opening','receipt','sale','return','adjustment','transfer_in','transfer_out')),
 quantity_delta numeric(18,4) not null check(quantity_delta<>0),
 reference_type text,
 reference_id uuid,
 idempotency_key uuid,
 notes text,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,warehouse_id) references public.warehouses(workspace_id,id) on delete restrict,
 foreign key(workspace_id,stock_id) references public.stock(workspace_id,id) on delete restrict,
 unique(workspace_id,idempotency_key)
);
create index if not exists stock_movements_workspace_stock_date_idx on public.stock_movements(workspace_id,stock_id,created_at desc);

create table if not exists public.purchase_orders (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 supplier_name text not null check(length(btrim(supplier_name)) between 1 and 200),
 supplier_reference text,
 status text not null default 'draft' check(status in ('draft','ordered','partially_received','received','cancelled')),
 order_date date not null default current_date,
 expected_date date,
 notes text,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,id),
 check(expected_date is null or expected_date>=order_date)
);
create index if not exists purchase_orders_workspace_status_idx on public.purchase_orders(workspace_id,status,order_date desc);
create table if not exists public.purchase_order_items (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 purchase_order_id uuid not null,
 stock_id uuid not null,
 quantity_ordered numeric(18,4) not null check(quantity_ordered>0),
 quantity_received numeric(18,4) not null default 0 check(quantity_received>=0 and quantity_received<=quantity_ordered),
 unit_cost numeric(18,4) not null check(unit_cost>=0),
 unique(workspace_id,id),
 foreign key(workspace_id,purchase_order_id) references public.purchase_orders(workspace_id,id) on delete cascade,
 foreign key(workspace_id,stock_id) references public.stock(workspace_id,id) on delete restrict
);
create table if not exists public.purchase_receipts (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 purchase_order_id uuid not null,
 warehouse_id uuid not null,
 idempotency_key uuid not null,
 received_by uuid not null references auth.users(id) on delete restrict,
 received_at timestamptz not null default now(),
 unique(workspace_id,id),
 unique(workspace_id,idempotency_key),
 foreign key(workspace_id,purchase_order_id) references public.purchase_orders(workspace_id,id) on delete restrict,
 foreign key(workspace_id,warehouse_id) references public.warehouses(workspace_id,id) on delete restrict
);
create table if not exists public.purchase_receipt_items (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 receipt_id uuid not null,
 purchase_order_item_id uuid not null,
 stock_id uuid not null,
 quantity numeric(18,4) not null check(quantity>0),
 batch_number text,
 expires_on date,
 foreign key(workspace_id,receipt_id) references public.purchase_receipts(workspace_id,id) on delete cascade,
 foreign key(workspace_id,purchase_order_item_id) references public.purchase_order_items(workspace_id,id) on delete restrict,
 foreign key(workspace_id,stock_id) references public.stock(workspace_id,id) on delete restrict
);

do $$
declare t text;
begin
 foreach t in array array['warehouses','stock_movements','purchase_orders','purchase_order_items','purchase_receipts','purchase_receipt_items'] loop
  execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;

drop policy if exists "warehouses read" on public.warehouses;
create policy "warehouses read" on public.warehouses for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'employee'::app_role,'storekeeper'::app_role]));
drop policy if exists "warehouses write" on public.warehouses;
create policy "warehouses write" on public.warehouses for all to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role]))
 with check(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role]));
drop policy if exists "stock movements read" on public.stock_movements;
create policy "stock movements read" on public.stock_movements for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'employee'::app_role,'storekeeper'::app_role]));
drop policy if exists "purchase orders read" on public.purchase_orders;
create policy "purchase orders read" on public.purchase_orders for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'accountant'::app_role]));
drop policy if exists "purchase orders write" on public.purchase_orders;
create policy "purchase orders write" on public.purchase_orders for all to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role]))
 with check(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role]));
drop policy if exists "purchase order items read" on public.purchase_order_items;
create policy "purchase order items read" on public.purchase_order_items for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'accountant'::app_role]));
drop policy if exists "purchase receipts read" on public.purchase_receipts;
create policy "purchase receipts read" on public.purchase_receipts for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'accountant'::app_role]));
drop policy if exists "purchase receipt items read" on public.purchase_receipt_items;
create policy "purchase receipt items read" on public.purchase_receipt_items for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'accountant'::app_role]));

grant select,insert,update,delete on public.warehouses to authenticated;
grant select on public.stock_movements,public.purchase_receipts,public.purchase_receipt_items to authenticated;
grant select,insert,update,delete on public.purchase_orders,public.purchase_order_items to authenticated;
commit;
