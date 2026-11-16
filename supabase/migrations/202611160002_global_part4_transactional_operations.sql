-- Part 4 transactional write operations for Global CRM, warehouses and purchasing.
begin;

create unique index if not exists global_purchase_order_items_workspace_id_uidx on global.purchase_order_items(workspace_id,id);

create table if not exists global.purchase_receipts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 purchase_order_id uuid not null,
 warehouse_id uuid not null,
 idempotency_key uuid not null,
 request_fingerprint text not null,
 received_by uuid not null references auth.users(id) on delete restrict,
 received_at timestamptz not null default now(),
 unique(workspace_id,id),
 unique(workspace_id,idempotency_key),
 foreign key(workspace_id,purchase_order_id) references global.purchase_orders(workspace_id,id) on delete restrict,
 foreign key(workspace_id,warehouse_id) references global.warehouses(workspace_id,id) on delete restrict
);
create table if not exists global.purchase_receipt_items (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 receipt_id uuid not null,
 purchase_order_item_id uuid not null,
 product_id uuid not null,
 quantity numeric(18,4) not null check(quantity>0),
 batch_number text,
 expires_on date,
 foreign key(workspace_id,receipt_id) references global.purchase_receipts(workspace_id,id) on delete cascade,
 foreign key(workspace_id,purchase_order_item_id) references global.purchase_order_items(workspace_id,id) on delete restrict,
 foreign key(workspace_id,product_id) references global.products(workspace_id,id) on delete restrict
);
alter table global.purchase_receipts enable row level security;
alter table global.purchase_receipt_items enable row level security;
drop policy if exists global_purchase_receipts_select_member on global.purchase_receipts;
create policy global_purchase_receipts_select_member on global.purchase_receipts for select to authenticated using(global.is_workspace_member(workspace_id));
drop policy if exists global_purchase_receipt_items_select_member on global.purchase_receipt_items;
create policy global_purchase_receipt_items_select_member on global.purchase_receipt_items for select to authenticated using(global.is_workspace_member(workspace_id));
grant select on global.purchase_receipts,global.purchase_receipt_items to authenticated;
grant all on global.purchase_receipts,global.purchase_receipt_items to service_role;

create or replace function public.global_part4_mutate(
 p_user_id uuid,p_workspace_id uuid,p_action text,p_values jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare
 v_role text; v_currency text; v_id uuid; v_row jsonb; v_item jsonb; v_order global.purchase_orders%rowtype;
 v_receipt global.purchase_receipts%rowtype; v_po_item global.purchase_order_items%rowtype;
 v_qty numeric(18,4); v_batch text; v_expiry date; v_received numeric(18,4); v_fingerprint text; v_subtotal numeric(20,0);
begin
 if p_user_id is null or p_workspace_id is null or jsonb_typeof(p_values)<>'object' then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
 select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
 if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
 if v_role not in ('owner','admin','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 select currency_code into v_currency from global.workspaces where id=p_workspace_id;
 if v_currency is null then return jsonb_build_object('ok',false,'reason','workspace_not_found'); end if;

 if p_action='create_warehouse' then
   if length(btrim(coalesce(p_values->>'code','')))=0 or length(btrim(coalesce(p_values->>'name','')))=0 then return jsonb_build_object('ok',false,'reason','invalid_warehouse'); end if;
   if coalesce((p_values->>'is_default')::boolean,false) then
     update global.warehouses set is_default=false where workspace_id=p_workspace_id and is_default;
   end if;
   insert into global.warehouses(workspace_id,code,name,address,is_default,created_by)
   values(p_workspace_id,upper(trim(p_values->>'code')),trim(p_values->>'name'),coalesce(p_values->'address','{}'::jsonb),coalesce((p_values->>'is_default')::boolean,false),p_user_id)
   returning id,to_jsonb(warehouses) into v_id,v_row;
   return jsonb_build_object('ok',true,'record',v_row);
 end if;

 if p_action='create_lead' then
   if length(btrim(coalesce(p_values->>'name','')))=0 or length(p_values->>'name')>200 then return jsonb_build_object('ok',false,'reason','invalid_lead'); end if;
   insert into global.crm_leads(workspace_id,name,company,email,phone,source,requirement,estimated_value_minor,currency_code,stage,score,next_follow_up_at,owner_id,created_by)
   values(p_workspace_id,trim(p_values->>'name'),p_values->>'company',p_values->>'email',p_values->>'phone',p_values->>'source',p_values->>'requirement',
     greatest(0,coalesce((p_values->>'estimated_value_minor')::bigint,0)),v_currency,
     coalesce(p_values->>'stage','new'),
     least(100,greatest(0,coalesce((p_values->>'score')::integer,0))),
     nullif(p_values->>'next_follow_up_at','')::timestamptz,
     nullif(p_values->>'owner_id','')::uuid,p_user_id)
   returning id,to_jsonb(crm_leads) into v_id,v_row;
   return jsonb_build_object('ok',true,'record',v_row);
 end if;

 if p_action='update_lead' then
   if nullif(p_values->>'lead_id','') is null then return jsonb_build_object('ok',false,'reason','invalid_lead'); end if;
   update global.crm_leads set
     stage=coalesce(nullif(p_values->>'stage',''),stage),
     next_follow_up_at=case when p_values ? 'next_follow_up_at' then nullif(p_values->>'next_follow_up_at','')::timestamptz else next_follow_up_at end,
     score=case when p_values ? 'score' then least(100,greatest(0,(p_values->>'score')::integer)) else score end,
     updated_at=now()
   where workspace_id=p_workspace_id and id=(p_values->>'lead_id')::uuid
   returning id,to_jsonb(crm_leads) into v_id,v_row;
   if v_id is null then return jsonb_build_object('ok',false,'reason','lead_not_found'); end if;
   return jsonb_build_object('ok',true,'record',v_row);
 end if;

 if p_action='add_lead_activity' then
   if nullif(p_values->>'lead_id','') is null or length(btrim(coalesce(p_values->>'body','')))=0 then return jsonb_build_object('ok',false,'reason','invalid_activity'); end if;
   insert into global.crm_activities(workspace_id,lead_id,activity_type,body,due_at,created_by)
   select p_workspace_id,(p_values->>'lead_id')::uuid,coalesce(p_values->>'activity_type','note'),trim(p_values->>'body'),nullif(p_values->>'due_at','')::timestamptz,p_user_id
   where exists(select 1 from global.crm_leads where workspace_id=p_workspace_id and id=(p_values->>'lead_id')::uuid)
   returning id,to_jsonb(crm_activities) into v_id,v_row;
   if v_id is null then return jsonb_build_object('ok',false,'reason','lead_not_found'); end if;
   return jsonb_build_object('ok',true,'record',v_row);
 end if;

 if p_action='create_purchase_order' then
   if length(btrim(coalesce(p_values->>'supplier_name','')))=0 or jsonb_typeof(p_values->'items')<>'array'
     or jsonb_array_length(p_values->'items')=0 or jsonb_array_length(p_values->'items')>200 then return jsonb_build_object('ok',false,'reason','invalid_purchase_order'); end if;
   if coalesce(p_values->>'currency_code',v_currency)<>v_currency then return jsonb_build_object('ok',false,'reason','invalid_currency'); end if;
   insert into global.purchase_orders(workspace_id,supplier_name,supplier_reference,status,currency_code,order_date,expected_date,notes,created_by)
   values(p_workspace_id,trim(p_values->>'supplier_name'),p_values->>'supplier_reference','ordered',v_currency,
     coalesce(nullif(p_values->>'order_date','')::date,current_date),nullif(p_values->>'expected_date','')::date,p_values->>'notes',p_user_id)
   returning * into v_order;
   v_subtotal := 0;
   for v_item in select value from jsonb_array_elements(p_values->'items') loop
     if nullif(v_item->>'product_id','') is null or coalesce((v_item->>'quantity_ordered')::numeric,0)<=0
       or coalesce((v_item->>'unit_cost_minor')::bigint,-1)<0 then raise exception 'invalid_purchase_item'; end if;
     v_subtotal := v_subtotal + round((v_item->>'quantity_ordered')::numeric * (v_item->>'unit_cost_minor')::numeric);
     insert into global.purchase_order_items(workspace_id,purchase_order_id,product_id,quantity_ordered,unit_cost_minor)
     values(p_workspace_id,v_order.id,(v_item->>'product_id')::uuid,(v_item->>'quantity_ordered')::numeric,(v_item->>'unit_cost_minor')::bigint);
   end loop;
   update global.purchase_orders set subtotal_minor=v_subtotal where id=v_order.id;
   return jsonb_build_object('ok',true,'purchase_order_id',v_order.id,'subtotal_minor',v_subtotal);
 end if;

 if p_action='receive_purchase_order' then
   if nullif(p_values->>'purchase_order_id','') is null or nullif(p_values->>'warehouse_id','') is null
     or nullif(p_values->>'idempotency_key','') is null or jsonb_typeof(p_values->'items')<>'array'
     or jsonb_array_length(p_values->'items')=0 or jsonb_array_length(p_values->'items')>200 then return jsonb_build_object('ok',false,'reason','invalid_receipt'); end if;
   v_fingerprint := md5(p_values::text);
   perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||(p_values->>'idempotency_key'),0));
   select * into v_order from global.purchase_orders where workspace_id=p_workspace_id and id=(p_values->>'purchase_order_id')::uuid for update;
   if not found then return jsonb_build_object('ok',false,'reason','purchase_order_not_found'); end if;
   if not exists(select 1 from global.warehouses where workspace_id=p_workspace_id and id=(p_values->>'warehouse_id')::uuid and is_active) then return jsonb_build_object('ok',false,'reason','warehouse_not_found'); end if;
   select * into v_receipt from global.purchase_receipts where workspace_id=p_workspace_id and idempotency_key=(p_values->>'idempotency_key')::uuid;
   if found then
     if v_receipt.received_by<>p_user_id or v_receipt.purchase_order_id<>v_order.id or v_receipt.warehouse_id<>(p_values->>'warehouse_id')::uuid or v_receipt.request_fingerprint<>v_fingerprint then
       return jsonb_build_object('ok',false,'reason','idempotency_conflict');
     end if;
     return jsonb_build_object('ok',true,'duplicate',true,'receipt_id',v_receipt.id);
   end if;
   insert into global.purchase_receipts(workspace_id,purchase_order_id,warehouse_id,idempotency_key,request_fingerprint,received_by)
   values(p_workspace_id,v_order.id,(p_values->>'warehouse_id')::uuid,(p_values->>'idempotency_key')::uuid,v_fingerprint,p_user_id) returning * into v_receipt;
   for v_item in select value from jsonb_array_elements(p_values->'items') loop
     v_qty := (v_item->>'quantity')::numeric;
     if v_qty is null or v_qty<=0 or v_qty<>round(v_qty,4) then raise exception 'invalid_receipt_item'; end if;
     select * into v_po_item from global.purchase_order_items where workspace_id=p_workspace_id and purchase_order_id=v_order.id and id=(v_item->>'purchase_order_item_id')::uuid for update;
     if not found or v_po_item.quantity_received+v_qty>v_po_item.quantity_ordered then raise exception 'receipt_quantity_exceeded'; end if;
     update global.purchase_order_items set quantity_received=quantity_received+v_qty where id=v_po_item.id;
     insert into global.warehouse_stock_levels(workspace_id,warehouse_id,product_id,quantity)
     values(p_workspace_id,v_receipt.warehouse_id,v_po_item.product_id,v_qty)
     on conflict(workspace_id,warehouse_id,product_id) do update set quantity=global.warehouse_stock_levels.quantity+excluded.quantity,updated_at=now();
     insert into global.stock_levels(workspace_id,product_id,quantity,reorder_level)
     values(p_workspace_id,v_po_item.product_id,v_qty,0)
     on conflict(workspace_id,product_id) do update set quantity=global.stock_levels.quantity+excluded.quantity,updated_at=now();
     insert into global.stock_movements(workspace_id,product_id,movement_type,quantity_delta,notes,created_by,idempotency_key)
     values(p_workspace_id,v_po_item.product_id,'receipt',v_qty,'Purchase receipt',p_user_id,gen_random_uuid());
     v_batch := nullif(trim(v_item->>'batch_number'),''); v_expiry := nullif(v_item->>'expires_on','')::date;
     if v_batch is not null then
       insert into global.inventory_batches(workspace_id,warehouse_id,product_id,batch_number,quantity,unit_cost_minor,expires_on)
       values(p_workspace_id,v_receipt.warehouse_id,v_po_item.product_id,v_batch,v_qty,v_po_item.unit_cost_minor,v_expiry)
       on conflict(workspace_id,warehouse_id,product_id,batch_number) do update set quantity=global.inventory_batches.quantity+excluded.quantity;
     end if;
     insert into global.purchase_receipt_items(workspace_id,receipt_id,purchase_order_item_id,product_id,quantity,batch_number,expires_on)
     values(p_workspace_id,v_receipt.id,v_po_item.id,v_po_item.product_id,v_qty,v_batch,v_expiry);
     insert into global.warehouse_stock_movements(workspace_id,warehouse_id,product_id,movement_type,quantity_delta,reference_type,reference_id,idempotency_key,notes,created_by)
     values(p_workspace_id,v_receipt.warehouse_id,v_po_item.product_id,'receipt',v_qty,'purchase_receipt',v_receipt.id,gen_random_uuid(),nullif(trim(v_order.notes),''),p_user_id);
   end loop;
   update global.purchase_orders po set status=case when not exists(select 1 from global.purchase_order_items i where i.workspace_id=p_workspace_id and i.purchase_order_id=po.id and i.quantity_received<i.quantity_ordered) then 'received'
     when exists(select 1 from global.purchase_order_items i where i.workspace_id=p_workspace_id and i.purchase_order_id=po.id and i.quantity_received>0) then 'partially_received' else po.status end
   where po.id=v_order.id;
   return jsonb_build_object('ok',true,'duplicate',false,'receipt_id',v_receipt.id);
 end if;
 return jsonb_build_object('ok',false,'reason','unsupported_action');
exception when others then
 if sqlerrm='invalid_purchase_item' then return jsonb_build_object('ok',false,'reason','invalid_purchase_item'); end if;
 if sqlerrm='invalid_receipt_item' then return jsonb_build_object('ok',false,'reason','invalid_receipt_item'); end if;
 if sqlerrm='receipt_quantity_exceeded' then return jsonb_build_object('ok',false,'reason','receipt_quantity_exceeded'); end if;
 raise;
end $$;

revoke all on function public.global_part4_mutate(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.global_part4_mutate(uuid,uuid,text,jsonb) to service_role;
commit;
