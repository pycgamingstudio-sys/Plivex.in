-- India edition transactional CRM/inventory procurement workflows.
-- All writes are authenticated, workspace-scoped and performed atomically in PostgreSQL.
begin;

alter table public.purchase_receipts add column if not exists request_fingerprint text;
alter table public.stock
 add column if not exists purchase_cost numeric(18,4) not null default 0 check(purchase_cost>=0),
 add column if not exists barcode text;

create table if not exists public.inventory_batches (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 warehouse_id uuid not null,
 stock_id uuid not null,
 batch_number text not null check(length(btrim(batch_number)) between 1 and 100),
 quantity numeric(18,4) not null default 0 check(quantity>=0),
 unit_cost numeric(18,4) not null default 0 check(unit_cost>=0),
 expires_on date,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,warehouse_id) references public.warehouses(workspace_id,id) on delete restrict,
 foreign key(workspace_id,stock_id) references public.stock(workspace_id,id) on delete restrict,
 unique(workspace_id,warehouse_id,stock_id,batch_number)
);
alter table public.inventory_batches enable row level security;
drop policy if exists "inventory batches read" on public.inventory_batches;
create policy "inventory batches read" on public.inventory_batches for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'employee'::app_role,'storekeeper'::app_role]));
grant select on public.inventory_batches to authenticated;
create index if not exists inventory_batches_expiry_idx on public.inventory_batches(workspace_id,warehouse_id,expires_on) where quantity>0 and expires_on is not null;



create table if not exists public.stock_transfers (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 from_warehouse_id uuid not null,
 to_warehouse_id uuid not null,
 idempotency_key uuid not null,
 request_fingerprint text not null,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 unique(workspace_id,id),
 unique(workspace_id,idempotency_key),
 foreign key(workspace_id,from_warehouse_id) references public.warehouses(workspace_id,id) on delete restrict,
 foreign key(workspace_id,to_warehouse_id) references public.warehouses(workspace_id,id) on delete restrict,
 check(from_warehouse_id<>to_warehouse_id)
);
create table if not exists public.stock_transfer_items (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 transfer_id uuid not null,
 source_stock_id uuid not null,
 destination_stock_id uuid not null,
 quantity numeric(18,4) not null check(quantity>0),
 foreign key(workspace_id,transfer_id) references public.stock_transfers(workspace_id,id) on delete cascade,
 foreign key(workspace_id,source_stock_id) references public.stock(workspace_id,id) on delete restrict,
 foreign key(workspace_id,destination_stock_id) references public.stock(workspace_id,id) on delete restrict
);
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
drop policy if exists "stock transfers read" on public.stock_transfers;
create policy "stock transfers read" on public.stock_transfers for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'storekeeper'::app_role]));
drop policy if exists "stock transfer items read" on public.stock_transfer_items;
create policy "stock transfer items read" on public.stock_transfer_items for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'storekeeper'::app_role]));
grant select on public.stock_transfers,public.stock_transfer_items to authenticated;

drop policy if exists "purchase orders read" on public.purchase_orders;
create policy "purchase orders read" on public.purchase_orders for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'accountant'::app_role,'storekeeper'::app_role]));
drop policy if exists "purchase order items read" on public.purchase_order_items;
create policy "purchase order items read" on public.purchase_order_items for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'accountant'::app_role,'storekeeper'::app_role]));
drop policy if exists "purchase receipts read" on public.purchase_receipts;
create policy "purchase receipts read" on public.purchase_receipts for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'accountant'::app_role,'storekeeper'::app_role]));
drop policy if exists "purchase receipt items read" on public.purchase_receipt_items;
create policy "purchase receipt items read" on public.purchase_receipt_items for select to authenticated
 using(has_ws_role(workspace_id,ARRAY['admin'::app_role,'manager'::app_role,'accountant'::app_role,'storekeeper'::app_role]));

-- Existing StockTab inserts do not know about warehouse_id. The trigger assigns
-- the workspace's default warehouse and creates it safely on the first stock row.
create or replace function public.ensure_stock_default_warehouse()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare v_warehouse uuid;
begin
 if new.warehouse_id is null then
   select id into v_warehouse from public.warehouses
   where workspace_id=new.workspace_id and is_default=true limit 1;
   if v_warehouse is null then
     insert into public.warehouses(workspace_id,code,name,is_default)
     values(new.workspace_id,'MAIN','Main Warehouse',true)
     on conflict(workspace_id,code) do update set is_default=true
     returning id into v_warehouse;
   end if;
   new.warehouse_id := v_warehouse;
 end if;
 return new;
end $$;
drop trigger if exists stock_default_warehouse_before_write on public.stock;
create trigger stock_default_warehouse_before_write
before insert or update of workspace_id,warehouse_id on public.stock
for each row execute function public.ensure_stock_default_warehouse();
revoke all on function public.ensure_stock_default_warehouse() from public,anon,authenticated;

-- Backfill opening movements so the audit timeline begins with the existing balance.
insert into public.stock_movements(workspace_id,warehouse_id,stock_id,movement_type,quantity_delta,reference_type,reference_id,idempotency_key,notes,created_by,created_at)
select s.workspace_id,s.warehouse_id,s.id,'opening',s.quantity,'opening_balance',s.id,gen_random_uuid(),'Opening balance migrated into warehouse ledger',m.owner_id,s.created_at
from public.stock s
join lateral (select wm.owner_id from public.workspace_members wm where wm.workspace_id=s.workspace_id and wm.status='active' order by (wm.role='admin'::app_role) desc limit 1) m on true
where s.quantity<>0 and not exists(select 1 from public.stock_movements sm where sm.workspace_id=s.workspace_id and sm.stock_id=s.id);

create or replace function public.india_part4_create_purchase_order(
 p_supplier_name text,p_items jsonb,p_supplier_reference text default null,p_expected_date date default null,p_notes text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare v_workspace text; v_user uuid:=auth.uid(); v_order public.purchase_orders%rowtype; v_item jsonb;
begin
 if v_user is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 select workspace_id into v_workspace from public.profiles where id=v_user;
 if v_workspace is null or not has_ws_role(v_workspace,ARRAY['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if nullif(trim(p_supplier_name),'') is null or length(p_supplier_name)>200 or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>200 then
   return jsonb_build_object('ok',false,'reason','invalid_purchase_order');
 end if;
 insert into public.purchase_orders(workspace_id,supplier_name,supplier_reference,status,expected_date,notes,created_by)
 values(v_workspace,trim(p_supplier_name),nullif(trim(p_supplier_reference),''),'ordered',p_expected_date,nullif(trim(p_notes),''),v_user)
 returning * into v_order;
 for v_item in select value from jsonb_array_elements(p_items) loop
   if nullif(v_item->>'stock_id','') is null or coalesce((v_item->>'quantity_ordered')::numeric,0)<=0
     or coalesce((v_item->>'unit_cost')::numeric,-1)<0
     or round((v_item->>'quantity_ordered')::numeric,4)<>(v_item->>'quantity_ordered')::numeric then
     raise exception 'invalid_purchase_order_item';
   end if;
   if not exists(select 1 from public.stock where workspace_id=v_workspace and id=(v_item->>'stock_id')::uuid) then
     raise exception 'stock_item_not_found';
   end if;
   insert into public.purchase_order_items(workspace_id,purchase_order_id,stock_id,quantity_ordered,unit_cost)
   values(v_workspace,v_order.id,(v_item->>'stock_id')::uuid,(v_item->>'quantity_ordered')::numeric,(v_item->>'unit_cost')::numeric);
 end loop;
 return jsonb_build_object('ok',true,'purchase_order_id',v_order.id);
exception when others then
 if sqlerrm in ('invalid_purchase_order_item','stock_item_not_found') then
   return jsonb_build_object('ok',false,'reason',sqlerrm);
 end if;
 raise;
end $$;

create or replace function public.india_part4_receive_purchase_order(
 p_purchase_order_id uuid,p_warehouse_id uuid,p_idempotency_key uuid,p_items jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare v_workspace text; v_user uuid:=auth.uid(); v_order public.purchase_orders%rowtype; v_receipt public.purchase_receipts%rowtype;
 v_item jsonb; v_po_item public.purchase_order_items%rowtype; v_stock public.stock%rowtype; v_dest public.stock%rowtype; v_qty numeric(18,4); v_fingerprint text;
begin
 if v_user is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 select workspace_id into v_workspace from public.profiles where id=v_user;
 if v_workspace is null or not has_ws_role(v_workspace,ARRAY['admin'::app_role,'manager'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_purchase_order_id is null or p_warehouse_id is null or p_idempotency_key is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>200 then
   return jsonb_build_object('ok',false,'reason','invalid_receipt');
 end if;
 v_fingerprint:=md5(jsonb_build_object('purchase_order_id',p_purchase_order_id,'warehouse_id',p_warehouse_id,'items',p_items)::text);
 perform pg_advisory_xact_lock(hashtextextended(v_workspace||':'||p_idempotency_key::text,0));
 select * into v_order from public.purchase_orders where workspace_id=v_workspace and id=p_purchase_order_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','purchase_order_not_found'); end if;
 if not exists(select 1 from public.warehouses where workspace_id=v_workspace and id=p_warehouse_id and is_active) then return jsonb_build_object('ok',false,'reason','warehouse_not_found'); end if;
 select * into v_receipt from public.purchase_receipts where workspace_id=v_workspace and idempotency_key=p_idempotency_key;
 if found then
   if v_receipt.received_by<>v_user or v_receipt.purchase_order_id<>p_purchase_order_id or v_receipt.warehouse_id<>p_warehouse_id or v_receipt.request_fingerprint is distinct from v_fingerprint then
     return jsonb_build_object('ok',false,'reason','idempotency_conflict');
   end if;
   return jsonb_build_object('ok',true,'duplicate',true,'receipt_id',v_receipt.id);
 end if;
 insert into public.purchase_receipts(workspace_id,purchase_order_id,warehouse_id,idempotency_key,request_fingerprint,received_by)
 values(v_workspace,p_purchase_order_id,p_warehouse_id,p_idempotency_key,v_fingerprint,v_user) returning * into v_receipt;
 for v_item in select value from jsonb_array_elements(p_items) loop
   v_qty:=(v_item->>'quantity')::numeric;
   if nullif(v_item->>'purchase_order_item_id','') is null or v_qty<=0 or v_qty<>round(v_qty,4) then raise exception 'invalid_receipt_item'; end if;
   select * into v_po_item from public.purchase_order_items where workspace_id=v_workspace and purchase_order_id=p_purchase_order_id and id=(v_item->>'purchase_order_item_id')::uuid for update;
   if not found or v_po_item.quantity_received+v_qty>v_po_item.quantity_ordered then raise exception 'receipt_quantity_exceeded'; end if;
   select * into v_stock from public.stock where workspace_id=v_workspace and id=v_po_item.stock_id;
   if not found then raise exception 'stock_item_not_found'; end if;
   select * into v_dest from public.stock where workspace_id=v_workspace and warehouse_id=p_warehouse_id
     and ((v_stock.sku is not null and sku=v_stock.sku) or (v_stock.sku is null and name=v_stock.name and unit is not distinct from v_stock.unit))
     order by created_at limit 1 for update;
   if v_dest.id is null then
     insert into public.stock(workspace_id,name,sku,quantity,unit,price,low_stock,client_id,warehouse_id)
     values(v_workspace,v_stock.name,v_stock.sku,0,v_stock.unit,v_stock.price,v_stock.low_stock,v_stock.client_id,p_warehouse_id)
     returning * into v_dest;
   end if;
   update public.stock set purchase_cost=case when quantity+v_qty>0 then ((quantity*purchase_cost)+(v_qty*v_po_item.unit_cost))/(quantity+v_qty) else v_po_item.unit_cost end,quantity=quantity+v_qty,updated_at=now() where id=v_dest.id;
   update public.purchase_order_items set quantity_received=quantity_received+v_qty where id=v_po_item.id;
   insert into public.purchase_receipt_items(workspace_id,receipt_id,purchase_order_item_id,stock_id,quantity,batch_number,expires_on)
   values(v_workspace,v_receipt.id,v_po_item.id,v_dest.id,v_qty,nullif(trim(v_item->>'batch_number'),''),nullif(v_item->>'expires_on','')::date);
   if nullif(trim(v_item->>'batch_number'),'') is not null then
     insert into public.inventory_batches(workspace_id,warehouse_id,stock_id,batch_number,quantity,unit_cost,expires_on)
     values(v_workspace,p_warehouse_id,v_dest.id,trim(v_item->>'batch_number'),v_qty,v_po_item.unit_cost,nullif(v_item->>'expires_on','')::date)
     on conflict(workspace_id,warehouse_id,stock_id,batch_number) do update
       set quantity=public.inventory_batches.quantity+excluded.quantity,
           unit_cost=excluded.unit_cost,expires_on=coalesce(excluded.expires_on,public.inventory_batches.expires_on);
   end if;
   insert into public.stock_movements(workspace_id,warehouse_id,stock_id,movement_type,quantity_delta,reference_type,reference_id,idempotency_key,notes,created_by)
   values(v_workspace,p_warehouse_id,v_dest.id,'receipt',v_qty,'purchase_receipt',v_receipt.id,gen_random_uuid(),'Purchase receipt',v_user);
 end loop;
 update public.purchase_orders po set status=case
   when not exists(select 1 from public.purchase_order_items i where i.workspace_id=v_workspace and i.purchase_order_id=po.id and i.quantity_received<i.quantity_ordered) then 'received'
   when exists(select 1 from public.purchase_order_items i where i.workspace_id=v_workspace and i.purchase_order_id=po.id and i.quantity_received>0) then 'partially_received'
   else po.status end,updated_at=now()
 where po.id=p_purchase_order_id;
 return jsonb_build_object('ok',true,'duplicate',false,'receipt_id',v_receipt.id);
exception when others then
 if sqlerrm in ('invalid_receipt_item','receipt_quantity_exceeded','stock_item_not_found') then return jsonb_build_object('ok',false,'reason',sqlerrm); end if;
 raise;
end $$;

create or replace function public.india_part4_transfer_stock(
 p_stock_id uuid,p_to_warehouse_id uuid,p_quantity numeric,p_idempotency_key uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare v_workspace text; v_user uuid:=auth.uid(); v_source public.stock%rowtype; v_dest public.stock%rowtype;
 v_transfer public.stock_transfers%rowtype; v_fingerprint text; v_dest_id uuid;
begin
 if v_user is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 select workspace_id into v_workspace from public.profiles where id=v_user;
 if v_workspace is null or not has_ws_role(v_workspace,ARRAY['admin'::app_role,'manager'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_stock_id is null or p_to_warehouse_id is null or p_idempotency_key is null or p_quantity is null or p_quantity<=0 or p_quantity<>round(p_quantity,4) then
   return jsonb_build_object('ok',false,'reason','invalid_transfer');
 end if;
 v_fingerprint:=md5(p_stock_id::text||':'||p_to_warehouse_id::text||':'||p_quantity::text);
 perform pg_advisory_xact_lock(hashtextextended(v_workspace||':'||p_idempotency_key::text,0));
 select * into v_transfer from public.stock_transfers where workspace_id=v_workspace and idempotency_key=p_idempotency_key;
 if found then
   if v_transfer.created_by<>v_user or v_transfer.request_fingerprint<>v_fingerprint then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
   return jsonb_build_object('ok',true,'duplicate',true,'transfer_id',v_transfer.id);
 end if;
 select * into v_source from public.stock where workspace_id=v_workspace and id=p_stock_id for update;
 if not found or v_source.warehouse_id=p_to_warehouse_id then return jsonb_build_object('ok',false,'reason','stock_item_not_found'); end if;
 if v_source.quantity<p_quantity then return jsonb_build_object('ok',false,'reason','insufficient_stock'); end if;
 if not exists(select 1 from public.warehouses where workspace_id=v_workspace and id=p_to_warehouse_id and is_active) then return jsonb_build_object('ok',false,'reason','warehouse_not_found'); end if;
 select * into v_dest from public.stock where workspace_id=v_workspace and warehouse_id=p_to_warehouse_id
   and ((v_source.sku is not null and sku=v_source.sku) or (v_source.sku is null and name=v_source.name and unit is not distinct from v_source.unit))
   order by created_at limit 1 for update;
 insert into public.stock_transfers(workspace_id,from_warehouse_id,to_warehouse_id,idempotency_key,request_fingerprint,created_by)
 values(v_workspace,v_source.warehouse_id,p_to_warehouse_id,p_idempotency_key,v_fingerprint,v_user) returning * into v_transfer;
 update public.stock set quantity=quantity-p_quantity,updated_at=now() where id=v_source.id;
 if v_dest.id is null then
   insert into public.stock(workspace_id,name,sku,quantity,unit,price,low_stock,client_id,warehouse_id,purchase_cost,barcode)
   values(v_workspace,v_source.name,v_source.sku,p_quantity,v_source.unit,v_source.price,v_source.low_stock,v_source.client_id,p_to_warehouse_id,v_source.purchase_cost,v_source.barcode)
   returning id into v_dest_id;
 else
   update public.stock set purchase_cost=case when quantity+p_quantity>0 then ((quantity*purchase_cost)+(p_quantity*v_source.purchase_cost))/(quantity+p_quantity) else v_source.purchase_cost end,quantity=quantity+p_quantity,updated_at=now() where id=v_dest.id returning id into v_dest_id;
 end if;
 insert into public.stock_transfer_items(workspace_id,transfer_id,source_stock_id,destination_stock_id,quantity)
 values(v_workspace,v_transfer.id,v_source.id,v_dest_id,p_quantity);
 insert into public.stock_movements(workspace_id,warehouse_id,stock_id,movement_type,quantity_delta,reference_type,reference_id,idempotency_key,notes,created_by)
 values(v_workspace,v_source.warehouse_id,v_source.id,'transfer_out',-p_quantity,'stock_transfer',v_transfer.id,gen_random_uuid(),'Warehouse transfer',v_user),
       (v_workspace,p_to_warehouse_id,v_dest_id,'transfer_in',p_quantity,'stock_transfer',v_transfer.id,gen_random_uuid(),'Warehouse transfer',v_user);
 return jsonb_build_object('ok',true,'duplicate',false,'transfer_id',v_transfer.id,'destination_stock_id',v_dest_id);
end $$;

revoke all on function public.india_part4_create_purchase_order(text,jsonb,text,date,text) from public,anon;
revoke all on function public.india_part4_receive_purchase_order(uuid,uuid,uuid,jsonb) from public,anon;
revoke all on function public.india_part4_transfer_stock(uuid,uuid,numeric,uuid) from public,anon;
grant execute on function public.india_part4_create_purchase_order(text,jsonb,text,date,text) to authenticated;
grant execute on function public.india_part4_receive_purchase_order(uuid,uuid,uuid,jsonb) to authenticated;
grant execute on function public.india_part4_transfer_stock(uuid,uuid,numeric,uuid) to authenticated;

commit;
