-- Part 4: Global CRM, multi-warehouse inventory and procurement foundation.
-- Additive only: preserves the existing India schema and current Global stock ledger.
begin;

create table if not exists global.warehouses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  code text not null check (length(btrim(code)) between 1 and 32),
  name text not null check (length(btrim(name)) between 1 and 160),
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address)='object'),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,id),
  unique(workspace_id,code)
);
create unique index if not exists global_warehouses_one_default_uidx
  on global.warehouses(workspace_id) where is_default;

create table if not exists global.warehouse_stock_levels (
  workspace_id uuid not null,
  warehouse_id uuid not null,
  product_id uuid not null,
  quantity numeric(18,4) not null default 0 check(quantity>=0),
  reorder_level numeric(18,4) not null default 0 check(reorder_level>=0),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,warehouse_id,product_id),
  foreign key(workspace_id,warehouse_id) references global.warehouses(workspace_id,id) on delete cascade,
  foreign key(workspace_id,product_id) references global.products(workspace_id,id) on delete restrict
);
create index if not exists global_warehouse_stock_low_idx
  on global.warehouse_stock_levels(workspace_id,warehouse_id,quantity,reorder_level);

create table if not exists global.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  warehouse_id uuid not null,
  product_id uuid not null,
  batch_number text not null check(length(btrim(batch_number)) between 1 and 100),
  quantity numeric(18,4) not null default 0 check(quantity>=0),
  unit_cost_minor bigint not null default 0 check(unit_cost_minor>=0),
  manufactured_on date,
  expires_on date,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,warehouse_id) references global.warehouses(workspace_id,id) on delete cascade,
  foreign key(workspace_id,product_id) references global.products(workspace_id,id) on delete restrict,
  unique(workspace_id,warehouse_id,product_id,batch_number),
  check(expires_on is null or manufactured_on is null or expires_on>=manufactured_on)
);
create index if not exists global_inventory_batches_expiry_idx
  on global.inventory_batches(workspace_id,warehouse_id,expires_on) where quantity>0 and expires_on is not null;

create table if not exists global.warehouse_stock_movements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  warehouse_id uuid not null,
  product_id uuid not null,
  movement_type text not null check(movement_type in ('receipt','transfer_in','transfer_out','adjustment')),
  quantity_delta numeric(18,4) not null check(quantity_delta<>0),
  reference_type text not null check(reference_type in ('purchase_receipt','stock_transfer','manual_adjustment')),
  reference_id uuid not null,
  idempotency_key uuid,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,warehouse_id) references global.warehouses(workspace_id,id) on delete restrict,
  foreign key(workspace_id,product_id) references global.products(workspace_id,id) on delete restrict,
  unique(workspace_id,idempotency_key)
);
create index if not exists global_warehouse_stock_movements_timeline_idx
  on global.warehouse_stock_movements(workspace_id,warehouse_id,product_id,created_at desc);

create table if not exists global.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  from_warehouse_id uuid not null,
  to_warehouse_id uuid not null,
  status text not null default 'completed' check(status in ('completed','cancelled')),
  idempotency_key uuid not null,
  request_fingerprint text not null,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,from_warehouse_id) references global.warehouses(workspace_id,id) on delete restrict,
  foreign key(workspace_id,to_warehouse_id) references global.warehouses(workspace_id,id) on delete restrict,
  unique(workspace_id,idempotency_key),
  unique(workspace_id,id),
  check(from_warehouse_id<>to_warehouse_id)
);
create table if not exists global.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  transfer_id uuid not null,
  product_id uuid not null,
  quantity numeric(18,4) not null check(quantity>0),
  foreign key(workspace_id,transfer_id) references global.stock_transfers(workspace_id,id) on delete cascade,
  foreign key(workspace_id,product_id) references global.products(workspace_id,id) on delete restrict
);

create table if not exists global.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  supplier_name text not null check(length(btrim(supplier_name)) between 1 and 200),
  supplier_reference text,
  status text not null default 'draft' check(status in ('draft','ordered','partially_received','received','cancelled')),
  currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),
  order_date date not null default current_date,
  expected_date date,
  subtotal_minor bigint not null default 0 check(subtotal_minor>=0),
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,id),
  check(expected_date is null or expected_date>=order_date)
);
create index if not exists global_purchase_orders_workspace_status_idx
  on global.purchase_orders(workspace_id,status,order_date desc);
create table if not exists global.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  purchase_order_id uuid not null,
  product_id uuid not null,
  quantity_ordered numeric(18,4) not null check(quantity_ordered>0),
  quantity_received numeric(18,4) not null default 0 check(quantity_received>=0 and quantity_received<=quantity_ordered),
  unit_cost_minor bigint not null check(unit_cost_minor>=0),
  foreign key(workspace_id,purchase_order_id) references global.purchase_orders(workspace_id,id) on delete cascade,
  foreign key(workspace_id,product_id) references global.products(workspace_id,id) on delete restrict
);

create table if not exists global.crm_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  name text not null check(length(btrim(name)) between 1 and 200),
  company text,
  email text,
  phone text,
  source text,
  requirement text,
  estimated_value_minor bigint not null default 0 check(estimated_value_minor>=0),
  currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),
  stage text not null default 'new' check(stage in ('new','qualified','proposal','negotiation','won','lost')),
  score smallint not null default 0 check(score between 0 and 100),
  next_follow_up_at timestamptz,
  owner_id uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,id)
);
create index if not exists global_crm_leads_workspace_stage_idx on global.crm_leads(workspace_id,stage,updated_at desc);
create index if not exists global_crm_leads_followup_idx on global.crm_leads(workspace_id,next_follow_up_at) where next_follow_up_at is not null;
create table if not exists global.crm_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lead_id uuid not null,
  activity_type text not null check(activity_type in ('note','call','email','meeting','stage_change','follow_up')),
  body text not null check(length(btrim(body)) between 1 and 4000),
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,lead_id) references global.crm_leads(workspace_id,id) on delete cascade
);
create index if not exists global_crm_activities_timeline_idx on global.crm_activities(workspace_id,lead_id,created_at desc);

do $$
declare t text;
begin
  foreach t in array array['warehouses','warehouse_stock_levels','inventory_batches','warehouse_stock_movements','stock_transfers','stock_transfer_items','purchase_orders','purchase_order_items','crm_leads','crm_activities'] loop
    execute format('alter table global.%I enable row level security',t);
    execute format('drop policy if exists %I on global.%I', 'global_'||t||'_select_member',t);
    execute format('create policy %I on global.%I for select to authenticated using (global.is_workspace_member(workspace_id))','global_'||t||'_select_member',t);
  end loop;
end $$;

grant select on global.warehouses,global.warehouse_stock_levels,global.inventory_batches,
  global.warehouse_stock_movements,global.stock_transfers,global.stock_transfer_items,global.purchase_orders,global.purchase_order_items,
  global.crm_leads,global.crm_activities to authenticated;
grant all on global.warehouses,global.warehouse_stock_levels,global.inventory_batches,
  global.warehouse_stock_movements,global.stock_transfers,global.stock_transfer_items,global.purchase_orders,global.purchase_order_items,
  global.crm_leads,global.crm_activities to service_role;

create or replace function public.global_part4_list(
  p_user_id uuid,p_workspace_id uuid,p_resource text,p_limit integer default 100
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,global
as $$
declare v_role text; v_rows jsonb;
begin
  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if p_resource not in ('warehouses','warehouse_stock_levels','inventory_batches','warehouse_stock_movements','stock_transfers','purchase_orders','purchase_order_items','crm_leads','crm_activities') then
    return jsonb_build_object('ok',false,'reason','unsupported_resource');
  end if;
  case p_resource
    when 'warehouses' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.warehouses where workspace_id=p_workspace_id order by is_default desc,name limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'warehouse_stock_levels' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.warehouse_stock_levels where workspace_id=p_workspace_id order by updated_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'inventory_batches' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.inventory_batches where workspace_id=p_workspace_id order by expires_on nulls last,created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'stock_transfers' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.stock_transfers where workspace_id=p_workspace_id order by created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'purchase_orders' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.purchase_orders where workspace_id=p_workspace_id order by order_date desc,created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'purchase_order_items' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.purchase_order_items where workspace_id=p_workspace_id order by purchase_order_id limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'crm_leads' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.crm_leads where workspace_id=p_workspace_id order by updated_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'crm_activities' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.crm_activities where workspace_id=p_workspace_id order by created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
  end case;
  return jsonb_build_object('ok',true,'records',coalesce(v_rows,'[]'::jsonb));
end $$;

create or replace function public.global_part4_transfer_stock(
 p_user_id uuid,p_workspace_id uuid,p_from uuid,p_to uuid,p_items jsonb,p_idempotency_key uuid,p_notes text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_role text; v_transfer global.stock_transfers%rowtype; v_item jsonb; v_product uuid; v_qty numeric(18,4); v_balance numeric(18,4); v_existing global.stock_transfers%rowtype; v_fingerprint text; v_batch global.inventory_batches%rowtype; v_batch_remaining numeric(18,4); v_batch_take numeric(18,4);
begin
 if p_user_id is null or p_workspace_id is null or p_from is null or p_to is null or p_from=p_to or p_idempotency_key is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>200 then
  return jsonb_build_object('ok',false,'reason','invalid_request');
 end if;
 select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
 if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
 if v_role not in ('owner','admin','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 v_fingerprint := md5(p_from::text||':'||p_to::text||':'||p_items::text||':'||coalesce(p_notes,''));
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||p_idempotency_key::text,0));
 select * into v_existing from global.stock_transfers where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
 if found then
   if v_existing.created_by<>p_user_id or v_existing.from_warehouse_id<>p_from or v_existing.to_warehouse_id<>p_to or v_existing.request_fingerprint<>v_fingerprint then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
   return jsonb_build_object('ok',true,'duplicate',true,'transfer_id',v_existing.id);
 end if;
 if not exists(select 1 from global.warehouses where workspace_id=p_workspace_id and id=p_from and is_active)
 or not exists(select 1 from global.warehouses where workspace_id=p_workspace_id and id=p_to and is_active) then return jsonb_build_object('ok',false,'reason','warehouse_not_found'); end if;
 insert into global.stock_transfers(workspace_id,from_warehouse_id,to_warehouse_id,idempotency_key,request_fingerprint,notes,created_by)
 values(p_workspace_id,p_from,p_to,p_idempotency_key,v_fingerprint,nullif(trim(p_notes),''),p_user_id) returning * into v_transfer;
 for v_item in select value from jsonb_array_elements(p_items) loop
   v_product := (v_item->>'product_id')::uuid; v_qty := (v_item->>'quantity')::numeric;
   if v_product is null or v_qty is null or v_qty<=0 or v_qty<>round(v_qty,4) then raise exception 'invalid_transfer_item'; end if;
   insert into global.warehouse_stock_levels(workspace_id,warehouse_id,product_id,quantity)
   values(p_workspace_id,p_from,v_product,0) on conflict do nothing;
   insert into global.warehouse_stock_levels(workspace_id,warehouse_id,product_id,quantity)
   values(p_workspace_id,p_to,v_product,0) on conflict do nothing;
   select quantity into v_balance from global.warehouse_stock_levels where workspace_id=p_workspace_id and warehouse_id=p_from and product_id=v_product for update;
   if v_balance<v_qty then raise exception 'insufficient_stock'; end if;
   update global.warehouse_stock_levels set quantity=quantity-v_qty,updated_at=now() where workspace_id=p_workspace_id and warehouse_id=p_from and product_id=v_product;
   update global.warehouse_stock_levels set quantity=quantity+v_qty,updated_at=now() where workspace_id=p_workspace_id and warehouse_id=p_to and product_id=v_product;
   v_batch_remaining:=v_qty;
   for v_batch in
     select * from global.inventory_batches where workspace_id=p_workspace_id and warehouse_id=p_from
       and product_id=v_product and quantity>0 order by expires_on nulls last,created_at,id for update
   loop
     exit when v_batch_remaining<=0;
     v_batch_take:=least(v_batch.quantity,v_batch_remaining);
     update global.inventory_batches set quantity=quantity-v_batch_take where id=v_batch.id;
     insert into global.inventory_batches(workspace_id,warehouse_id,product_id,batch_number,quantity,unit_cost_minor,expires_on)
     values(p_workspace_id,p_to,v_product,v_batch.batch_number,v_batch_take,v_batch.unit_cost_minor,v_batch.expires_on)
     on conflict(workspace_id,warehouse_id,product_id,batch_number) do update
       set quantity=global.inventory_batches.quantity+excluded.quantity;
     v_batch_remaining:=v_batch_remaining-v_batch_take;
   end loop;
   insert into global.stock_transfer_items(workspace_id,transfer_id,product_id,quantity) values(p_workspace_id,v_transfer.id,v_product,v_qty);
   insert into global.warehouse_stock_movements(workspace_id,warehouse_id,product_id,movement_type,quantity_delta,reference_type,reference_id,idempotency_key,notes,created_by)
   values(p_workspace_id,p_from,v_product,'transfer_out',-v_qty,'stock_transfer',v_transfer.id,gen_random_uuid(),nullif(trim(p_notes),''),p_user_id),
         (p_workspace_id,p_to,v_product,'transfer_in',v_qty,'stock_transfer',v_transfer.id,gen_random_uuid(),nullif(trim(p_notes),''),p_user_id);
 end loop;
 return jsonb_build_object('ok',true,'duplicate',false,'transfer_id',v_transfer.id);
exception when others then
 if sqlerrm='insufficient_stock' then return jsonb_build_object('ok',false,'reason','insufficient_stock'); end if;
 if sqlerrm='invalid_transfer_item' then return jsonb_build_object('ok',false,'reason','invalid_transfer_item'); end if;
 raise;
end $$;

revoke all on function public.global_part4_list(uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.global_part4_transfer_stock(uuid,uuid,uuid,uuid,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.global_part4_list(uuid,uuid,text,integer) to service_role;
grant execute on function public.global_part4_transfer_stock(uuid,uuid,uuid,uuid,jsonb,uuid,text) to service_role;

commit;
