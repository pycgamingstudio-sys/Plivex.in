-- Global product barcode and variant metadata. Variants are stock-bearing product rows.
alter table global.products
 add column if not exists barcode text,
 add column if not exists variant_of uuid,
 add column if not exists variant_label text;
do $$
begin
 if not exists(select 1 from pg_constraint where conname='global_products_workspace_variant_fk') then
  alter table global.products add constraint global_products_workspace_variant_fk
   foreign key(workspace_id,variant_of) references global.products(workspace_id,id) on delete restrict;
 end if;
end $$;
create unique index if not exists global_products_workspace_barcode_uidx
 on global.products(workspace_id,barcode) where barcode is not null and length(btrim(barcode))>0;
create index if not exists global_products_workspace_variant_idx
 on global.products(workspace_id,variant_of) where variant_of is not null;

-- Every Global workspace gets a default warehouse, including future workspaces.
create or replace function global.create_default_warehouse_for_workspace()
returns trigger language plpgsql security definer set search_path=pg_catalog,global
as $$
begin
 insert into global.warehouses(workspace_id,code,name,is_default,created_by)
 values(new.id,'MAIN','Main Warehouse',true,new.created_by)
 on conflict(workspace_id,code) do nothing;
 return new;
end $$;
drop trigger if exists global_workspaces_default_warehouse on global.workspaces;
create trigger global_workspaces_default_warehouse after insert on global.workspaces
 for each row execute function global.create_default_warehouse_for_workspace();
revoke all on function global.create_default_warehouse_for_workspace() from public,anon,authenticated;

insert into global.warehouses(workspace_id,code,name,is_default,created_by)
select w.id,'MAIN','Main Warehouse',true,w.created_by
from global.workspaces w
where not exists(select 1 from global.warehouses wh where wh.workspace_id=w.id and wh.is_default)
on conflict(workspace_id,code) do nothing;

-- Migrate the existing single-location balance into each workspace's default warehouse.
insert into global.warehouse_stock_levels(workspace_id,warehouse_id,product_id,quantity,reorder_level)
select s.workspace_id,w.id,s.product_id,s.quantity,s.reorder_level
from global.stock_levels s
join global.warehouses w on w.workspace_id=s.workspace_id and w.is_default
on conflict(workspace_id,warehouse_id,product_id) do nothing;

insert into global.warehouse_stock_movements(workspace_id,warehouse_id,product_id,movement_type,quantity_delta,reference_type,reference_id,idempotency_key,notes,created_by,created_at)
select s.workspace_id,w.id,s.product_id,'adjustment',s.quantity,'manual_adjustment',s.product_id,gen_random_uuid(),
       'Opening warehouse balance migrated from the legacy stock ledger',ws.created_by,now()
from global.stock_levels s
join global.warehouses w on w.workspace_id=s.workspace_id and w.is_default
join global.workspaces ws on ws.id=s.workspace_id
where s.quantity<>0
and not exists(select 1 from global.warehouse_stock_movements m where m.workspace_id=s.workspace_id and m.warehouse_id=w.id and m.product_id=s.product_id);

-- Newly created products are immediately represented in the default warehouse.
create or replace function global.ensure_product_stock_level()
returns trigger language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_warehouse uuid;
begin
 insert into global.stock_levels(workspace_id,product_id,quantity,reorder_level)
 values(new.workspace_id,new.id,0,0) on conflict(workspace_id,product_id) do nothing;
 select id into v_warehouse from global.warehouses where workspace_id=new.workspace_id and is_default and is_active limit 1;
 if v_warehouse is not null then
   insert into global.warehouse_stock_levels(workspace_id,warehouse_id,product_id,quantity,reorder_level)
   values(new.workspace_id,v_warehouse,new.id,0,0) on conflict(workspace_id,warehouse_id,product_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function global.ensure_product_stock_level() from public,anon,authenticated;
grant execute on function global.ensure_product_stock_level() to service_role;

-- Extend the warehouse movement vocabulary for invoiced sales.
alter table global.warehouse_stock_movements drop constraint if exists warehouse_stock_movements_movement_type_check;
alter table global.warehouse_stock_movements add constraint warehouse_stock_movements_movement_type_check
 check(movement_type in ('receipt','transfer_in','transfer_out','adjustment','sale'));
alter table global.warehouse_stock_movements drop constraint if exists warehouse_stock_movements_reference_type_check;
alter table global.warehouse_stock_movements add constraint warehouse_stock_movements_reference_type_check
 check(reference_type in ('purchase_receipt','stock_transfer','manual_adjustment','sales_invoice'));

create unique index if not exists global_invoice_items_invoice_id_uidx on global.invoice_items(invoice_id,id);

create table if not exists global.invoice_stock_allocations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 invoice_id uuid not null,
 invoice_item_id uuid not null,
 product_id uuid not null,
 warehouse_id uuid not null,
 batch_id uuid,
 quantity numeric(18,4) not null check(quantity>0),
 created_at timestamptz not null default now(),
 foreign key(workspace_id,invoice_id) references global.invoices(workspace_id,id) on delete cascade,
 foreign key(invoice_id,invoice_item_id) references global.invoice_items(invoice_id,id) on delete cascade,
 foreign key(workspace_id,product_id) references global.products(workspace_id,id) on delete restrict,
 foreign key(workspace_id,warehouse_id) references global.warehouses(workspace_id,id) on delete restrict,
 foreign key(batch_id) references global.inventory_batches(id) on delete restrict
);
create index if not exists global_invoice_stock_allocations_invoice_idx
 on global.invoice_stock_allocations(workspace_id,invoice_id,created_at);
alter table global.invoice_stock_allocations enable row level security;
drop policy if exists global_invoice_stock_allocations_select_member on global.invoice_stock_allocations;
create policy global_invoice_stock_allocations_select_member on global.invoice_stock_allocations
 for select to authenticated using(global.is_workspace_member(workspace_id));
grant select on global.invoice_stock_allocations to authenticated;

create or replace function public.global_apply_invoice_stock(p_workspace_id uuid,p_invoice_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,global
as $$
declare
 v_warehouse uuid;
 v_item record;
 v_level numeric(18,4);
 v_remaining numeric(18,4);
 v_batch global.inventory_batches%rowtype;
 v_batch_remaining numeric(18,4);
 v_take numeric(18,4);
 v_has_batches boolean;
begin
 select id into v_warehouse from global.warehouses
 where workspace_id=p_workspace_id and is_default and is_active limit 1;
 if v_warehouse is null then raise exception 'invoice_warehouse_not_found'; end if;
 for v_item in
   select id,product_id,quantity from global.invoice_items
   where workspace_id=p_workspace_id and invoice_id=p_invoice_id and product_id is not null
   order by sort_order,id
 loop
   insert into global.warehouse_stock_levels(workspace_id,warehouse_id,product_id,quantity,reorder_level)
   values(p_workspace_id,v_warehouse,v_item.product_id,0,0)
   on conflict(workspace_id,warehouse_id,product_id) do nothing;
   select quantity into v_level from global.warehouse_stock_levels
   where workspace_id=p_workspace_id and warehouse_id=v_warehouse and product_id=v_item.product_id for update;
   if v_level<v_item.quantity then raise exception 'insufficient_stock'; end if;
   select exists(select 1 from global.inventory_batches where workspace_id=p_workspace_id and warehouse_id=v_warehouse
     and product_id=v_item.product_id and quantity>0) into v_has_batches;
   if v_has_batches then
     v_batch_remaining:=v_item.quantity;
     for v_batch in
       select * from global.inventory_batches where workspace_id=p_workspace_id and warehouse_id=v_warehouse
         and product_id=v_item.product_id and quantity>0 and (expires_on is null or expires_on>=current_date)
       order by expires_on nulls last,created_at,id for update
     loop
       exit when v_batch_remaining<=0;
       v_take:=least(v_batch.quantity,v_batch_remaining);
       update global.inventory_batches set quantity=quantity-v_take where id=v_batch.id;
       insert into global.invoice_stock_allocations(workspace_id,invoice_id,invoice_item_id,product_id,warehouse_id,batch_id,quantity)
       values(p_workspace_id,p_invoice_id,v_item.id,v_item.product_id,v_warehouse,v_batch.id,v_take);
       v_batch_remaining:=v_batch_remaining-v_take;
     end loop;
     if v_batch_remaining>0 then raise exception 'insufficient_batch_stock'; end if;
   else
     insert into global.invoice_stock_allocations(workspace_id,invoice_id,invoice_item_id,product_id,warehouse_id,batch_id,quantity)
     values(p_workspace_id,p_invoice_id,v_item.id,v_item.product_id,v_warehouse,null,v_item.quantity);
   end if;
   update global.warehouse_stock_levels set quantity=quantity-v_item.quantity,updated_at=now()
   where workspace_id=p_workspace_id and warehouse_id=v_warehouse and product_id=v_item.product_id;
   update global.stock_levels set quantity=greatest(0,quantity-v_item.quantity),updated_at=now()
   where workspace_id=p_workspace_id and product_id=v_item.product_id;
   insert into global.warehouse_stock_movements(workspace_id,warehouse_id,product_id,movement_type,quantity_delta,reference_type,reference_id,idempotency_key,notes,created_by)
   values(p_workspace_id,v_warehouse,v_item.product_id,'sale',-v_item.quantity,'sales_invoice',p_invoice_id,gen_random_uuid(),'Invoice stock deduction',p_user_id);
   insert into global.stock_movements(workspace_id,product_id,movement_type,quantity_delta,notes,created_by,idempotency_key)
   values(p_workspace_id,v_item.product_id,'sale',-v_item.quantity,'Invoice stock deduction',p_user_id,gen_random_uuid());
 end loop;
end $$;
revoke all on function public.global_apply_invoice_stock(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.global_issue_invoice(
  p_user_id uuid,
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_tax_context jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_workspace global.workspaces%rowtype;
  v_profile global.business_profiles%rowtype;
  v_client global.clients%rowtype;
  v_invoice global.invoices%rowtype;
  v_existing global.invoices%rowtype;
  v_item global.invoice_items%rowtype;
  v_line_base bigint;
  v_line_tax bigint;
  v_subtotal_after_discount bigint;
  v_tax bigint := 0;
  v_total bigint;
  v_taxable bigint;
  v_number bigint;
  v_invoice_number text;
  v_price_mode text;
  v_place text;
  v_tax_snapshot jsonb;
  v_issuance_fingerprint text;
  v_items jsonb;
begin
  if p_user_id is null or p_workspace_id is null or p_invoice_id is null
    or p_idempotency_key is null or jsonb_typeof(coalesce(p_tax_context,'null')) <> 'object' then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;

  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  v_issuance_fingerprint := md5(p_tax_context::text);
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':issue:' || p_idempotency_key::text,0));
  select * into v_existing from global.invoices
  where workspace_id=p_workspace_id and issuance_idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.id <> p_invoice_id or v_existing.invoice_snapshot->>'issuance_request_fingerprint' is distinct from v_issuance_fingerprint then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict');
    end if;
    return jsonb_build_object('ok',true,'duplicate',true,'invoice',to_jsonb(v_existing));
  end if;

  select * into v_workspace from global.workspaces where id=p_workspace_id;
  select * into v_profile from global.business_profiles where workspace_id=p_workspace_id;
  select * into v_invoice from global.invoices
  where id=p_invoice_id and workspace_id=p_workspace_id
  for update;
  if v_invoice.id is null then return jsonb_build_object('ok',false,'reason','invoice_not_found'); end if;
  if v_invoice.status <> 'draft' then return jsonb_build_object('ok',false,'reason','invoice_not_draft'); end if;
  if v_invoice.client_id is not null then
    select * into v_client from global.clients
    where id=v_invoice.client_id and workspace_id=p_workspace_id;
  end if;

  -- First release deliberately enables only GB standard-rated VAT.
  if v_workspace.country_code <> 'GB' or v_workspace.currency_code <> 'GBP'
    or v_profile.country_code <> 'GB' or v_profile.currency_code <> 'GBP' then
    return jsonb_build_object('ok',false,'reason','country_not_enabled');
  end if;
  if v_profile.tax_registration_status <> 'registered'
    or upper(coalesce(v_profile.tax_registration_type,'')) <> 'VAT'
    or nullif(btrim(v_profile.tax_registration_number),'') is null
    or v_profile.tax_registration_effective_from is null
    or v_invoice.issue_date < v_profile.tax_registration_effective_from
    or nullif(btrim(v_profile.legal_name),'') is null
    or nullif(btrim(v_profile.address),'') is null then
    return jsonb_build_object('ok',false,'reason','seller_profile_incomplete');
  end if;
  if coalesce((p_tax_context->>'registration_confirmed')::boolean,false) is not true
    or coalesce((p_tax_context->>'place_of_supply_confirmed')::boolean,false) is not true
    or coalesce((p_tax_context->>'tax_category_confirmed')::boolean,false) is not true
    or lower(coalesce(p_tax_context->>'tax_category','')) <> 'standard-rated'
    or coalesce(p_tax_context->>'mode','') <> 'automatic'
    or coalesce(p_tax_context->>'price_mode','') not in ('exclusive','inclusive')
    or lower(btrim(coalesce(p_tax_context->>'place_of_supply',''))) <> 'united kingdom' then
    return jsonb_build_object('ok',false,'reason','tax_evidence_incomplete');
  end if;
  if v_invoice.currency_code <> 'GBP' or v_invoice.subtotal_minor < v_invoice.discount_minor then
    return jsonb_build_object('ok',false,'reason','invalid_invoice_amounts');
  end if;

  v_price_mode := p_tax_context->>'price_mode';
  v_place := left(btrim(p_tax_context->>'place_of_supply'),180);
  v_subtotal_after_discount := v_invoice.subtotal_minor-v_invoice.discount_minor;

  for v_item in
    select * from global.invoice_items
    where workspace_id=p_workspace_id and invoice_id=p_invoice_id
    order by sort_order, id
    for update
  loop
    v_line_base := v_item.line_total_minor;
    if v_price_mode = 'inclusive' then
      v_line_tax := round(v_line_base::numeric * 2000 / 12000)::bigint;
    else
      v_line_tax := round(v_line_base::numeric * 2000 / 10000)::bigint;
    end if;
    v_tax := v_tax+v_line_tax;
    update global.invoice_items set tax_rate_bps=2000,tax_minor=v_line_tax,
      line_total_minor=case when v_price_mode='exclusive' then v_line_base+v_line_tax else v_line_base end
    where id=v_item.id and workspace_id=p_workspace_id;
  end loop;

  if v_price_mode = 'inclusive' then
    v_taxable := v_subtotal_after_discount-v_tax;
    v_total := v_subtotal_after_discount;
  else
    v_taxable := v_subtotal_after_discount;
    v_total := v_subtotal_after_discount+v_tax;
  end if;
  if v_tax < 0 or v_total < 0 or v_total > 9000000000000000 then
    return jsonb_build_object('ok',false,'reason','invoice_total_limit');
  end if;

  insert into global.invoice_number_sequences(workspace_id,invoice_year,last_number)
  values(p_workspace_id,extract(year from v_invoice.issue_date)::integer,1)
  on conflict(workspace_id,invoice_year) do update
    set last_number=global.invoice_number_sequences.last_number+1,updated_at=now()
  returning last_number into v_number;
  v_invoice_number := 'INV-GB-' || extract(year from v_invoice.issue_date)::integer::text || '-' || lpad(v_number::text,6,'0');

  v_tax_snapshot := jsonb_build_object(
    'document_status','issued',
    'issuance_request_fingerprint',v_issuance_fingerprint,
    'country_code','GB',
    'currency_code','GBP',
    'tax_status','calculated',
    'tax_mode','automatic',
    'price_mode',v_price_mode,
    'tax_category','standard-rated',
    'place_of_supply',v_place,
    'registration_attested',true,
    'seller',jsonb_build_object(
      'legal_name',v_profile.legal_name,
      'address',v_profile.address,
      'email',v_profile.email,
      'phone',v_profile.phone,
      'tax_registration_number',v_profile.tax_registration_number,
      'tax_registration_type',v_profile.tax_registration_type,
      'tax_registration_status',v_profile.tax_registration_status,
      'tax_registration_effective_from',v_profile.tax_registration_effective_from
    ),
    'buyer',case when v_client.id is null then jsonb_build_object('name','Customer') else jsonb_build_object(
      'name',v_client.name,'email',v_client.email,'phone',v_client.phone,
      'tax_registration_number',v_client.tax_registration_number,
      'billing_address',v_client.billing_address,'shipping_address',v_client.shipping_address
    ) end,
    'calculation',jsonb_build_object(
      'taxable_minor',v_taxable,
      'tax_minor',v_tax,
      'total_minor',v_total,
      'components',jsonb_build_array(jsonb_build_object(
        'id','GB-VAT-STANDARD-2026-11','name','VAT','rate_bps',2000,'amount_minor',v_tax
      )),
      'rule',jsonb_build_object(
        'id','GB-VAT-STANDARD-2026-11','version','2026.11',
        'source','https://www.gov.uk/vat-rates',
        'effective_from','2011-01-04','reviewed_on','2026-11-14'
      )
    ),
    'finalized_at',now(),
    'issued_by',p_user_id
  );

  update global.invoices set
    invoice_number=v_invoice_number,
    status='issued',
    tax_minor=v_tax,
    total_minor=v_total,
    invoice_snapshot=v_tax_snapshot,
    issuance_idempotency_key=p_idempotency_key,
    updated_at=now()
  where id=p_invoice_id and workspace_id=p_workspace_id
  returning * into v_invoice;

  perform public.global_apply_invoice_stock(p_workspace_id,p_invoice_id,p_user_id);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order),'[]'::jsonb)
    into v_items from global.invoice_items t
    where t.workspace_id=p_workspace_id and t.invoice_id=p_invoice_id;

  return jsonb_build_object('ok',true,'duplicate',false,'invoice',to_jsonb(v_invoice),'items',v_items);
end;
$function$;



create or replace function public.global_record_stock_movement(
  p_user_id uuid,
  p_workspace_id uuid,
  p_product_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_notes text default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_current numeric(18,4);
  v_next numeric(18,4);
  v_existing global.stock_movements%rowtype;
  v_movement global.stock_movements%rowtype;
  v_warehouse uuid;
  v_wh_current numeric(18,4);
  v_wh_next numeric(18,4);
begin
  if p_user_id is null or p_workspace_id is null or p_product_id is null
     or p_idempotency_key is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if p_movement_type is null or p_movement_type not in ('opening','receipt','sale','return','adjustment')
     or p_quantity_delta is null
     or p_quantity_delta = 0
     or abs(p_quantity_delta) > 1000000000000
     or p_quantity_delta <> round(p_quantity_delta, 4)
     or (p_movement_type in ('opening','receipt','return') and p_quantity_delta < 0)
     or (p_movement_type = 'sale' and p_quantity_delta > 0)
     or (p_movement_type = 'adjustment' and p_quantity_delta = 0) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_movement');
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_notes');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_idempotency_key::text, 0));

  select wm.role into v_role
  from global.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_user_id
    and wm.status = 'active'
  limit 1;
  if v_role is null then
    return jsonb_build_object('ok', false, 'reason', 'access_denied');
  end if;
  if v_role not in ('owner','admin','manager') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_existing
  from global.stock_movements
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.created_by <> p_user_id
       or v_existing.product_id <> p_product_id
       or v_existing.movement_type <> p_movement_type
       or v_existing.quantity_delta <> p_quantity_delta
       or coalesce(v_existing.notes,'') <> coalesce(nullif(trim(p_notes),''),'') then
      return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
    end if;
    select quantity into v_current from global.stock_levels
      where workspace_id = p_workspace_id and product_id = p_product_id;
    return jsonb_build_object('ok', true, 'duplicate', true,
      'movement_id', v_existing.id, 'quantity', coalesce(v_current,0));
  end if;

  if not exists (
    select 1 from global.products p
    where p.workspace_id = p_workspace_id and p.id = p_product_id and p.is_active
  ) then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  insert into global.stock_levels(workspace_id, product_id, quantity, reorder_level)
  values (p_workspace_id, p_product_id, 0, 0)
  on conflict (workspace_id, product_id) do nothing;

  select quantity into v_current
  from global.stock_levels
  where workspace_id = p_workspace_id and product_id = p_product_id
  for update;
  v_next := v_current + p_quantity_delta;
  if v_next < 0 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_stock',
      'available', v_current);
  end if;

  select id into v_warehouse from global.warehouses
  where workspace_id=p_workspace_id and is_default=true and is_active=true limit 1;
  if v_warehouse is null then return jsonb_build_object('ok',false,'reason','warehouse_not_found'); end if;
  insert into global.warehouse_stock_levels(workspace_id,warehouse_id,product_id,quantity,reorder_level)
  values(p_workspace_id,v_warehouse,p_product_id,0,0)
  on conflict(workspace_id,warehouse_id,product_id) do nothing;
  select quantity into v_wh_current from global.warehouse_stock_levels
  where workspace_id=p_workspace_id and warehouse_id=v_warehouse and product_id=p_product_id for update;
  v_wh_next:=v_wh_current+p_quantity_delta;
  if v_wh_next<0 then
    return jsonb_build_object('ok',false,'reason','insufficient_stock','available',v_wh_current);
  end if;

  insert into global.stock_movements(
    workspace_id, product_id, movement_type, quantity_delta,
    notes, created_by, idempotency_key
  ) values (
    p_workspace_id, p_product_id, p_movement_type, p_quantity_delta,
    nullif(trim(p_notes),''), p_user_id, p_idempotency_key
  ) returning * into v_movement;

  update global.stock_levels
  set quantity = v_next, updated_at = now()
  where workspace_id = p_workspace_id and product_id = p_product_id;

  update global.warehouse_stock_levels set quantity=v_wh_next,updated_at=now()
  where workspace_id=p_workspace_id and warehouse_id=v_warehouse and product_id=p_product_id;
  insert into global.warehouse_stock_movements(workspace_id,warehouse_id,product_id,movement_type,quantity_delta,reference_type,reference_id,idempotency_key,notes,created_by)
  values(p_workspace_id,v_warehouse,p_product_id,
    case when p_movement_type='sale' then 'sale' when p_movement_type='receipt' then 'receipt' else 'adjustment' end,
    p_quantity_delta,'manual_adjustment',v_movement.id,gen_random_uuid(),nullif(trim(p_notes),''),p_user_id);

  return jsonb_build_object('ok', true, 'duplicate', false,
    'movement_id', v_movement.id, 'quantity', v_next);
end;
$function$;

revoke all on function public.global_record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.global_record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid) to service_role;
