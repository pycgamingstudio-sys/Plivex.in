-- Harden Main Workspace sales-document idempotency and fulfilment invariants.
begin;
alter table public.sales_orders add column request_fingerprint text;
alter table public.delivery_challans add column request_fingerprint text;
alter table public.credit_debit_notes add column request_fingerprint text;
alter table public.sales_orders add constraint sales_orders_request_fingerprint_format check(request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');
alter table public.delivery_challans add constraint delivery_challans_request_fingerprint_format check(request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');
alter table public.credit_debit_notes add constraint credit_debit_notes_request_fingerprint_format check(request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');
create or replace function public.main_workspace_create_sales_order(p_workspace_id text,p_client_id uuid,p_client_name text,p_items jsonb,p_expected_date date default null,p_notes text default null,p_idempotency_key uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_currency text;v_order public.sales_orders%rowtype;v_item jsonb;v_qty numeric;v_price numeric;v_tax numeric;v_sub numeric:=0;v_tax_total numeric:=0;v_line_sub numeric;v_line_tax numeric;v_desc text;v_stock uuid;v_number text;v_fingerprint text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if nullif(btrim(p_client_name),'') is null or length(p_client_name)>200 or coalesce(jsonb_array_length(case when jsonb_typeof(p_items)='array' then p_items else '[]'::jsonb end),0) not between 1 and 200 or p_idempotency_key is null then return jsonb_build_object('ok',false,'reason','invalid_order'); end if;
 select currency_code into v_currency from public.workspace_settings where workspace_id=p_workspace_id;
 if v_currency is null or v_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('ok',false,'reason','workspace_currency_not_ready'); end if;
 if p_client_id is not null and not exists(select 1 from public.clients where id=p_client_id and workspace_id=p_workspace_id) then return jsonb_build_object('ok',false,'reason','client_not_found'); end if;
 v_fingerprint:=encode(pg_catalog.sha256(convert_to(jsonb_build_object('client_id',p_client_id,'client_name',btrim(p_client_name),'items',p_items,'expected_date',p_expected_date,'notes',nullif(btrim(p_notes),''))::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id||':'||p_idempotency_key::text,0));
 select * into v_order from public.sales_orders where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key for update;
 if found then
  if v_order.request_fingerprint is distinct from v_fingerprint then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
  return jsonb_build_object('ok',true,'sales_order_id',v_order.id,'duplicate',true);
 end if;
 v_number:='SO-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.sales_orders(workspace_id,order_number,client_id,client_name,currency_code,expected_date,notes,idempotency_key,request_fingerprint,created_by) values(p_workspace_id,v_number,p_client_id,btrim(p_client_name),v_currency,p_expected_date,nullif(btrim(p_notes),''),p_idempotency_key,v_fingerprint,v_user) returning * into v_order;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_desc:=nullif(btrim(v_item->>'description'),'');v_qty:=coalesce((v_item->>'quantity')::numeric,0);v_price:=coalesce((v_item->>'unit_price')::numeric,-1);v_tax:=coalesce((v_item->>'tax_rate')::numeric,0);v_stock:=nullif(v_item->>'stock_id','')::uuid;
  if v_desc is null or length(v_desc)>300 or v_qty::text in ('NaN','Infinity','-Infinity') or v_price::text in ('NaN','Infinity','-Infinity') or v_tax::text in ('NaN','Infinity','-Infinity') or v_qty<=0 or v_price<0 or v_tax<0 or v_tax>100 or round(v_qty,4)<>v_qty or round(v_price,4)<>v_price then raise exception 'invalid_sales_order_item'; end if;
  if v_stock is not null and not exists(select 1 from public.stock where id=v_stock and workspace_id=p_workspace_id) then raise exception 'stock_item_not_found'; end if;
  v_line_sub:=round(v_qty*v_price,4);v_line_tax:=round(v_line_sub*v_tax/100,4);
  insert into public.sales_order_items(workspace_id,sales_order_id,stock_id,description,quantity,unit_price,tax_rate,line_subtotal,line_tax,line_total) values(p_workspace_id,v_order.id,v_stock,v_desc,v_qty,v_price,v_tax,v_line_sub,v_line_tax,v_line_sub+v_line_tax);
  v_sub:=v_sub+v_line_sub;v_tax_total:=v_tax_total+v_line_tax;
 end loop;
 update public.sales_orders set subtotal=v_sub,tax_total=v_tax_total,total=v_sub+v_tax_total,updated_at=now() where id=v_order.id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'sales_order.created','sales_order',v_order.id::text,jsonb_build_object('order_number',v_number,'total',v_sub+v_tax_total,'currency_code',v_currency));
 return jsonb_build_object('ok',true,'sales_order_id',v_order.id,'order_number',v_number,'total',v_sub+v_tax_total,'currency_code',v_currency);
exception when others then if sqlerrm in ('invalid_sales_order_item','stock_item_not_found') then return jsonb_build_object('ok',false,'reason',sqlerrm); end if; if sqlstate in ('22P02','22003') then return jsonb_build_object('ok',false,'reason','invalid_sales_order_item'); end if; raise;
end; $function$;

create or replace function public.main_workspace_create_delivery_challan(p_workspace_id text,p_sales_order_id uuid,p_items jsonb,p_idempotency_key uuid,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_order public.sales_orders%rowtype;v_challan public.delivery_challans%rowtype;v_item jsonb;v_order_item public.sales_order_items%rowtype;v_qty numeric;v_done numeric;v_number text;v_fingerprint text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_idempotency_key is null or coalesce(jsonb_array_length(case when jsonb_typeof(p_items)='array' then p_items else '[]'::jsonb end),0) not between 1 and 200 then return jsonb_build_object('ok',false,'reason','invalid_challan'); end if;
 if exists(select 1 from jsonb_array_elements(p_items) as x(item) group by item->>'sales_order_item_id' having count(*)>1) then return jsonb_build_object('ok',false,'reason','duplicate_challan_item'); end if;
 v_fingerprint:=encode(pg_catalog.sha256(convert_to(jsonb_build_object('sales_order_id',p_sales_order_id,'items',p_items,'notes',nullif(btrim(p_notes),''))::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id||':'||p_idempotency_key::text,0));
 select * into v_challan from public.delivery_challans where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key for update;
 if found then
  if v_challan.request_fingerprint is distinct from v_fingerprint then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
  return jsonb_build_object('ok',true,'delivery_challan_id',v_challan.id,'duplicate',true);
 end if;
 select * into v_order from public.sales_orders where workspace_id=p_workspace_id and id=p_sales_order_id for update;
 if not found or v_order.status not in ('confirmed','partially_fulfilled') then return jsonb_build_object('ok',false,'reason','sales_order_not_confirmed'); end if;
 v_number:='DC-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.delivery_challans(workspace_id,challan_number,sales_order_id,client_name,idempotency_key,request_fingerprint,notes,created_by) values(p_workspace_id,v_number,v_order.id,v_order.client_name,p_idempotency_key,v_fingerprint,nullif(btrim(p_notes),''),v_user) returning * into v_challan;
 for v_item in select value from jsonb_array_elements(p_items) loop
  select * into v_order_item from public.sales_order_items where workspace_id=p_workspace_id and id=(v_item->>'sales_order_item_id')::uuid and sales_order_id=v_order.id for update;
  if not found then raise exception 'sales_order_item_not_found'; end if;
  v_qty:=coalesce((v_item->>'quantity')::numeric,0);
  select coalesce(sum(dci.quantity),0) into v_done from public.delivery_challan_items dci join public.delivery_challans dc on dc.id=dci.delivery_challan_id where dci.workspace_id=p_workspace_id and dci.sales_order_item_id=v_order_item.id and dc.status in ('draft','dispatched','received');
  if v_qty::text in ('NaN','Infinity','-Infinity') or v_qty<=0 or v_qty+v_done>v_order_item.quantity then raise exception 'challan_quantity_exceeds_order'; end if;
  insert into public.delivery_challan_items(workspace_id,delivery_challan_id,sales_order_item_id,stock_id,description,quantity) values(p_workspace_id,v_challan.id,v_order_item.id,v_order_item.stock_id,v_order_item.description,v_qty);
 end loop;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'delivery_challan.created','delivery_challan',v_challan.id::text,jsonb_build_object('challan_number',v_number,'sales_order_id',v_order.id));
 return jsonb_build_object('ok',true,'delivery_challan_id',v_challan.id,'challan_number',v_number);
exception when others then if sqlerrm in ('sales_order_item_not_found','challan_quantity_exceeds_order') then return jsonb_build_object('ok',false,'reason',sqlerrm); end if; if sqlstate in ('22P02','22003') then return jsonb_build_object('ok',false,'reason','invalid_challan_item'); end if; raise;
end; $function$;

create or replace function public.main_workspace_create_credit_debit_note(p_workspace_id text,p_invoice_id uuid,p_note_type text,p_reason text,p_amount numeric,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_invoice public.invoices%rowtype;v_note public.credit_debit_notes%rowtype;v_credited numeric;v_doc_type text;v_number text;v_fingerprint text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_note_type not in ('credit','debit') or nullif(btrim(p_reason),'') is null or length(p_reason)>1000 or p_amount is null or p_amount<=0 or p_idempotency_key is null then return jsonb_build_object('ok',false,'reason','invalid_note'); end if;
 select * into v_invoice from public.invoices where workspace_id=p_workspace_id and id=p_invoice_id for share;
 if not found or v_invoice.is_draft or lower(v_invoice.status) in ('draft','cancelled','void') then return jsonb_build_object('ok',false,'reason','source_invoice_not_issued'); end if;
 v_fingerprint:=encode(pg_catalog.sha256(convert_to(jsonb_build_object('invoice_id',p_invoice_id,'note_type',p_note_type,'reason',btrim(p_reason),'amount',p_amount)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id||':'||p_idempotency_key::text,0));
 select * into v_note from public.credit_debit_notes where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key for update;
 if found then
  if v_note.request_fingerprint is distinct from v_fingerprint then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
  return jsonb_build_object('ok',true,'note_id',v_note.id,'duplicate',true);
 end if;
 if p_note_type='credit' then select coalesce(sum(amount),0) into v_credited from public.credit_debit_notes where workspace_id=p_workspace_id and invoice_id=p_invoice_id and note_type='credit' and status='issued'; if v_credited+p_amount>v_invoice.total then return jsonb_build_object('ok',false,'reason','credit_exceeds_remaining_invoice_total'); end if; end if;
 v_doc_type:=case p_note_type when 'credit' then 'CN' else 'DN' end;v_number:=v_doc_type||'-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.credit_debit_notes(workspace_id,note_number,invoice_id,note_type,reason,amount,currency_code,idempotency_key,request_fingerprint,created_by) values(p_workspace_id,v_number,p_invoice_id,p_note_type,btrim(p_reason),p_amount,v_invoice.currency,p_idempotency_key,v_fingerprint,v_user) returning * into v_note;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,p_note_type||'_note.created',p_note_type||'_note',v_note.id::text,jsonb_build_object('invoice_id',p_invoice_id,'amount',p_amount,'currency_code',v_invoice.currency));
 return jsonb_build_object('ok',true,'note_id',v_note.id,'note_number',v_number,'currency_code',v_invoice.currency);
end; $function$;

create or replace function public.main_workspace_set_sales_document_status(p_workspace_id text,p_document_type text,p_document_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_found uuid;v_amount numeric;v_invoice uuid;v_credited numeric;v_sales_order uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_document_type='sales_order' and p_status='fulfilled' and exists(
  select 1 from public.sales_order_items soi
  where soi.workspace_id=p_workspace_id and soi.sales_order_id=p_document_id
    and coalesce((select sum(dci.quantity) from public.delivery_challan_items dci
      join public.delivery_challans dc on dc.workspace_id=dci.workspace_id and dc.id=dci.delivery_challan_id
      where dci.workspace_id=p_workspace_id and dci.sales_order_item_id=soi.id and dc.status in ('dispatched','received')),0)<soi.quantity
 ) then return jsonb_build_object('ok',false,'reason','fulfillment_incomplete'); end if;
 if p_document_type='sales_order' and p_status in ('confirmed','cancelled','fulfilled') then
  update public.sales_orders set status=p_status,updated_at=now() where workspace_id=p_workspace_id and id=p_document_id and ((p_status='confirmed' and status='draft') or (p_status='cancelled' and status in ('draft','confirmed','partially_fulfilled')) or (p_status='fulfilled' and status='partially_fulfilled')) returning id into v_found;
 elsif p_document_type='delivery_challan' and p_status in ('dispatched','received','cancelled') then
  update public.delivery_challans set status=p_status,updated_at=now()
   where workspace_id=p_workspace_id and id=p_document_id
    and ((p_status='dispatched' and status='draft') or (p_status='received' and status='dispatched') or (p_status='cancelled' and status in ('draft','dispatched')))
   returning id,sales_order_id into v_found,v_sales_order;
  if v_sales_order is not null then
   update public.sales_orders so set status=case
    when exists(select 1 from public.delivery_challans dc join public.delivery_challan_items dci
      on dci.workspace_id=dc.workspace_id and dci.delivery_challan_id=dc.id
      where dc.workspace_id=p_workspace_id and dc.sales_order_id=v_sales_order and dc.status in ('dispatched','received'))
     and not exists(select 1 from public.sales_order_items soi
      where soi.workspace_id=p_workspace_id and soi.sales_order_id=v_sales_order
       and coalesce((select sum(dci.quantity) from public.delivery_challan_items dci
        join public.delivery_challans dc on dc.workspace_id=dci.workspace_id and dc.id=dci.delivery_challan_id
        where dci.workspace_id=p_workspace_id and dci.sales_order_item_id=soi.id and dc.status in ('dispatched','received')),0)<soi.quantity)
     then 'fulfilled'
    when exists(select 1 from public.delivery_challans dc join public.delivery_challan_items dci
      on dci.workspace_id=dc.workspace_id and dci.delivery_challan_id=dc.id
      where dc.workspace_id=p_workspace_id and dc.sales_order_id=v_sales_order and dc.status in ('dispatched','received'))
     then 'partially_fulfilled'
    else 'confirmed' end,updated_at=now()
   where so.workspace_id=p_workspace_id and so.id=v_sales_order and so.status in ('confirmed','partially_fulfilled','fulfilled');
  end if;
 elsif p_document_type='credit_debit_note' and p_status in ('issued','cancelled') then
  select invoice_id,amount into v_invoice,v_amount from public.credit_debit_notes where workspace_id=p_workspace_id and id=p_document_id and status='draft' and note_type='credit' for update;
  if v_invoice is not null and p_status='issued' then
   select total into v_credited from public.invoices where workspace_id=p_workspace_id and id=v_invoice for update;
   if (select coalesce(sum(amount),0) from public.credit_debit_notes where workspace_id=p_workspace_id and invoice_id=v_invoice and note_type='credit' and status='issued')+v_amount>v_credited then return jsonb_build_object('ok',false,'reason','credit_exceeds_remaining_invoice_total'); end if;
  end if;
  update public.credit_debit_notes set status=p_status,updated_at=now() where workspace_id=p_workspace_id and id=p_document_id and status='draft' returning id into v_found;
 else return jsonb_build_object('ok',false,'reason','invalid_transition'); end if;
 if v_found is null then return jsonb_build_object('ok',false,'reason','document_not_found_or_transition_invalid'); end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,p_document_type||'.'||p_status,p_document_type,v_found::text,jsonb_build_object('status',p_status));
 return jsonb_build_object('ok',true);
end; $function$;
commit;
