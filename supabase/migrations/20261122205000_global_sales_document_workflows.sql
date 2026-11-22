-- Add sales order, delivery challan and credit/debit note workflows.
begin;
-- Sales order, delivery challan and credit/debit note foundations.
begin;
create table if not exists global.sales_orders (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references global.workspaces(id) on delete cascade,
 client_id uuid not null, order_number text not null, order_date date not null, expected_date date, currency_code text not null,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 100),
 subtotal_minor bigint not null check(subtotal_minor>=0), status text not null default 'draft' check(status in ('draft','confirmed','fulfilled','cancelled')),
 notes text, idempotency_key uuid not null, request_fingerprint text not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,order_number), unique(workspace_id,idempotency_key)
);
create table if not exists global.delivery_challans (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references global.workspaces(id) on delete cascade,
 client_id uuid not null, sales_order_id uuid, challan_number text not null, challan_date date not null,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 100),
 status text not null default 'draft' check(status in ('draft','issued','delivered','returned','cancelled')),
 notes text, idempotency_key uuid not null, request_fingerprint text not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,challan_number), unique(workspace_id,idempotency_key)
);
create table if not exists global.credit_debit_notes (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references global.workspaces(id) on delete cascade,
 invoice_id uuid not null references global.invoices(id) on delete restrict, client_id uuid not null,
 note_type text not null check(note_type in ('credit','debit')), note_number text not null, note_date date not null,
 reason text not null check(length(btrim(reason)) between 1 and 500), currency_code text not null,
 taxable_minor bigint not null check(taxable_minor>0), tax_minor bigint not null check(tax_minor>=0),
 total_minor bigint not null check(total_minor=taxable_minor+tax_minor and total_minor>0),
 status text not null default 'draft' check(status in ('draft','issued','void')), notes text, issued_at timestamptz,
 idempotency_key uuid not null, request_fingerprint text not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,note_number), unique(workspace_id,idempotency_key)
);


do $$
declare t text;
begin
 foreach t in array array['sales_orders','delivery_challans','credit_debit_notes'] loop
   execute format('alter table global.%I enable row level security',t);
   execute format('revoke all on global.%I from public,anon,authenticated',t);
   execute format('grant all on global.%I to service_role',t);
   execute format('drop policy if exists %I on global.%I', 'global_'||t||'_member_read',t);
   execute format('create policy %I on global.%I for select to authenticated using(global.is_workspace_member(workspace_id))','global_'||t||'_member_read',t);
 end loop;
end $$;

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
  if p_resource not in ('warehouses','warehouse_stock_levels','inventory_batches','warehouse_stock_movements','stock_transfers','purchase_orders','purchase_order_items','crm_leads','crm_activities','suppliers','sales_orders','delivery_challans','credit_debit_notes') then
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
    when 'suppliers' then select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'email',x.email,'phone',x.phone,'tax_registration_number',x.tax_registration_number)),'[]'::jsonb) into v_rows from (select id,name,email,phone,tax_registration_number from global.suppliers where workspace_id=p_workspace_id order by lower(name),id limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'sales_orders' then select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_rows from (select * from global.sales_orders where workspace_id=p_workspace_id order by order_date desc,created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'delivery_challans' then select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_rows from (select * from global.delivery_challans where workspace_id=p_workspace_id order by challan_date desc,created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'credit_debit_notes' then select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_rows from (select * from global.credit_debit_notes where workspace_id=p_workspace_id order by note_date desc,created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
  end case;
  return jsonb_build_object('ok',true,'records',coalesce(v_rows,'[]'::jsonb));
end $$;
create or replace function public.global_part4_mutate(
 p_user_id uuid,p_workspace_id uuid,p_action text,p_values jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare
 v_role text; v_currency text; v_id uuid; v_row jsonb; v_item jsonb; v_order global.purchase_orders%rowtype;
 v_receipt global.purchase_receipts%rowtype; v_po_item global.purchase_order_items%rowtype;
 v_qty numeric(18,4); v_batch text; v_client uuid; v_key uuid; v_number text; v_existing_id uuid; v_existing_fingerprint text; v_price bigint; v_discount bigint; v_taxable bigint; v_tax bigint; v_total bigint; v_invoice global.invoices%rowtype; v_expiry date; v_received numeric(18,4); v_fingerprint text; v_subtotal numeric(20,0);
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

 if p_action='create_sales_order' then
   v_client:=nullif(p_values->>'client_id','')::uuid;
   v_key:=nullif(p_values->>'idempotency_key','')::uuid;
   if v_client is null or v_key is null or jsonb_typeof(p_values->'items')<>'array' or jsonb_array_length(p_values->'items')<1 or jsonb_array_length(p_values->'items')>100 then
     return jsonb_build_object('ok',false,'reason','invalid_sales_order');
   end if;
   if not exists(select 1 from global.clients where id=v_client and workspace_id=p_workspace_id and status='active') then
     return jsonb_build_object('ok',false,'reason','client_not_found');
   end if;
   if coalesce(p_values->>'currency_code',v_currency)<>v_currency then return jsonb_build_object('ok',false,'reason','invalid_currency'); end if;
   v_fingerprint:=md5(p_values::text);
   perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':sales_order:'||v_key::text,0));
   select id,request_fingerprint into v_existing_id,v_existing_fingerprint from global.sales_orders where workspace_id=p_workspace_id and idempotency_key=v_key;
   if v_existing_id is not null then
     if v_existing_fingerprint<>v_fingerprint then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
     return jsonb_build_object('ok',true,'duplicate',true,'record_id',v_existing_id);
   end if;
   v_subtotal:=0;
   for v_item in select value from jsonb_array_elements(p_values->'items') loop
     v_qty:=(v_item->>'quantity')::numeric; v_price:=(v_item->>'unit_price_minor')::bigint; v_discount:=coalesce((v_item->>'discount_minor')::bigint,0);
     if length(btrim(coalesce(v_item->>'description','')))=0 or v_qty<=0 or v_qty>1000000 or v_qty<>round(v_qty,4)
       or v_price<0 or v_discount<0 or v_discount>round(v_qty*v_price) then raise exception 'invalid_sales_order_item'; end if;
     v_subtotal:=v_subtotal+round(v_qty*v_price)-v_discount;
   end loop;
   v_id:=gen_random_uuid(); v_number:='SO-'||to_char(coalesce(nullif(p_values->>'order_date','')::date,current_date),'YYYYMMDD')||'-'||upper(substr(v_id::text,1,8));
   insert into global.sales_orders(id,workspace_id,client_id,order_number,order_date,expected_date,currency_code,items,subtotal_minor,status,notes,idempotency_key,request_fingerprint,created_by)
   values(v_id,p_workspace_id,v_client,v_number,coalesce(nullif(p_values->>'order_date','')::date,current_date),nullif(p_values->>'expected_date','')::date,
     v_currency,p_values->'items',v_subtotal,'draft',nullif(btrim(p_values->>'notes'),''),v_key,v_fingerprint,p_user_id);
   return jsonb_build_object('ok',true,'record_id',v_id,'document_number',v_number,'subtotal_minor',v_subtotal);
 end if;

 if p_action='update_sales_order_status' then
   update global.sales_orders set status=p_values->>'status',updated_at=now()
   where workspace_id=p_workspace_id and id=(p_values->>'sales_order_id')::uuid and status in ('draft','confirmed')
     and p_values->>'status' in ('confirmed','fulfilled','cancelled')
   returning id,to_jsonb(sales_orders) into v_id,v_row;
   if v_id is null then return jsonb_build_object('ok',false,'reason','sales_order_not_found'); end if;
   return jsonb_build_object('ok',true,'record',v_row);
 end if;

 if p_action='create_delivery_challan' then
   v_key:=nullif(p_values->>'idempotency_key','')::uuid;
   v_client:=nullif(p_values->>'client_id','')::uuid;
   if v_key is null or jsonb_typeof(p_values->'items')<>'array' or jsonb_array_length(p_values->'items')<1 or jsonb_array_length(p_values->'items')>100 then
     return jsonb_build_object('ok',false,'reason','invalid_delivery_challan');
   end if;
   if nullif(p_values->>'sales_order_id','') is not null then
     select client_id into v_client from global.sales_orders where id=(p_values->>'sales_order_id')::uuid and workspace_id=p_workspace_id;
     if v_client is null then return jsonb_build_object('ok',false,'reason','sales_order_not_found'); end if;
   end if;
   if v_client is null or not exists(select 1 from global.clients where id=v_client and workspace_id=p_workspace_id and status='active') then
     return jsonb_build_object('ok',false,'reason','client_not_found');
   end if;
   v_fingerprint:=md5(p_values::text);
   perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':delivery_challan:'||v_key::text,0));
   select id,request_fingerprint into v_existing_id,v_existing_fingerprint from global.delivery_challans where workspace_id=p_workspace_id and idempotency_key=v_key;
   if v_existing_id is not null then
     if v_existing_fingerprint<>v_fingerprint then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
     return jsonb_build_object('ok',true,'duplicate',true,'record_id',v_existing_id);
   end if;
   for v_item in select value from jsonb_array_elements(p_values->'items') loop
     v_qty:=(v_item->>'quantity')::numeric;
     if length(btrim(coalesce(v_item->>'description','')))=0 or v_qty<=0 or v_qty>1000000 or v_qty<>round(v_qty,4) then raise exception 'invalid_delivery_challan_item'; end if;
   end loop;
   v_id:=gen_random_uuid(); v_number:='DC-'||to_char(coalesce(nullif(p_values->>'challan_date','')::date,current_date),'YYYYMMDD')||'-'||upper(substr(v_id::text,1,8));
   insert into global.delivery_challans(id,workspace_id,client_id,sales_order_id,challan_number,challan_date,items,status,notes,idempotency_key,request_fingerprint,created_by)
   values(v_id,p_workspace_id,v_client,nullif(p_values->>'sales_order_id','')::uuid,v_number,coalesce(nullif(p_values->>'challan_date','')::date,current_date),
     p_values->'items','draft',nullif(btrim(p_values->>'notes'),''),v_key,v_fingerprint,p_user_id);
   return jsonb_build_object('ok',true,'record_id',v_id,'document_number',v_number);
 end if;

 if p_action='update_delivery_challan_status' then
   update global.delivery_challans set status=p_values->>'status',updated_at=now()
   where workspace_id=p_workspace_id and id=(p_values->>'challan_id')::uuid
     and ((status='draft' and p_values->>'status' in ('issued','cancelled'))
       or (status='issued' and p_values->>'status' in ('delivered','returned','cancelled')))
   returning id,to_jsonb(delivery_challans) into v_id,v_row;
   if v_id is null then return jsonb_build_object('ok',false,'reason','delivery_challan_not_found'); end if;
   return jsonb_build_object('ok',true,'record',v_row);
 end if;

 if p_action='create_credit_debit_note' then
   v_key:=nullif(p_values->>'idempotency_key','')::uuid;
   if v_key is null or nullif(p_values->>'invoice_id','') is null
     or p_values->>'note_type' not in ('credit','debit') or length(btrim(coalesce(p_values->>'reason','')))=0 then
     return jsonb_build_object('ok',false,'reason','invalid_credit_debit_note');
   end if;
   select * into v_invoice from global.invoices where id=(p_values->>'invoice_id')::uuid and workspace_id=p_workspace_id for update;
   if v_invoice.id is null then return jsonb_build_object('ok',false,'reason','invoice_not_found'); end if;
   v_taxable:=coalesce((p_values->>'taxable_minor')::bigint,0);
   v_tax:=coalesce((p_values->>'tax_minor')::bigint,0);
   v_total:=coalesce((p_values->>'total_minor')::bigint,0);
   if v_taxable<=0 or v_tax<0 or v_total<>v_taxable+v_tax or v_total>9000000000000000 then return jsonb_build_object('ok',false,'reason','invalid_note_amount'); end if;
   if p_values->>'note_type'='credit' then
     if v_total+coalesce((select sum(total_minor) from global.credit_debit_notes where workspace_id=p_workspace_id and invoice_id=v_invoice.id and note_type='credit' and status in ('draft','issued')),0)>v_invoice.total_minor then
       return jsonb_build_object('ok',false,'reason','credit_note_exceeds_invoice');
     end if;
   end if;
   v_fingerprint:=md5(p_values::text);
   perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':credit_debit_note:'||v_key::text,0));
   select id,request_fingerprint into v_existing_id,v_existing_fingerprint from global.credit_debit_notes where workspace_id=p_workspace_id and idempotency_key=v_key;
   if v_existing_id is not null then
     if v_existing_fingerprint<>v_fingerprint then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
     return jsonb_build_object('ok',true,'duplicate',true,'record_id',v_existing_id);
   end if;
   v_id:=gen_random_uuid(); v_number:=case when p_values->>'note_type'='credit' then 'CN-' else 'DN-' end||to_char(coalesce(nullif(p_values->>'note_date','')::date,current_date),'YYYYMMDD')||'-'||upper(substr(v_id::text,1,8));
   insert into global.credit_debit_notes(id,workspace_id,invoice_id,client_id,note_type,note_number,note_date,reason,currency_code,taxable_minor,tax_minor,total_minor,status,notes,idempotency_key,request_fingerprint,created_by)
   values(v_id,p_workspace_id,v_invoice.id,v_invoice.client_id,p_values->>'note_type',v_number,coalesce(nullif(p_values->>'note_date','')::date,current_date),
     left(trim(p_values->>'reason'),500),v_invoice.currency_code,v_taxable,v_tax,v_total,'draft',nullif(btrim(p_values->>'notes'),''),v_key,v_fingerprint,p_user_id);
   return jsonb_build_object('ok',true,'record_id',v_id,'document_number',v_number);
 end if;

 if p_action='update_credit_debit_note_status' then
   update global.credit_debit_notes set status=p_values->>'status',issued_at=case when p_values->>'status'='issued' then now() else issued_at end,updated_at=now()
   where workspace_id=p_workspace_id and id=(p_values->>'note_id')::uuid and status='draft' and p_values->>'status' in ('issued','void')
   returning id,to_jsonb(credit_debit_notes) into v_id,v_row;
   if v_id is null then return jsonb_build_object('ok',false,'reason','credit_debit_note_not_found'); end if;
   return jsonb_build_object('ok',true,'record',v_row);
 end if;

 return jsonb_build_object('ok',false,'reason','unsupported_action');
exception when others then
 if sqlerrm='invalid_purchase_item' then return jsonb_build_object('ok',false,'reason','invalid_purchase_item'); end if;
 if sqlerrm='invalid_receipt_item' then return jsonb_build_object('ok',false,'reason','invalid_receipt_item'); end if;
 if sqlerrm='receipt_quantity_exceeded' then return jsonb_build_object('ok',false,'reason','receipt_quantity_exceeded'); end if;
 raise;
end $$;

revoke all on function public.global_part4_list(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.global_part4_list(uuid,uuid,text,integer) to service_role;
revoke all on function public.global_part4_mutate(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.global_part4_mutate(uuid,uuid,text,jsonb) to service_role;

commit;
