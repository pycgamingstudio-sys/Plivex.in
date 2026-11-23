-- Main Workspace sales orders, delivery challans and credit/debit notes.
begin;
create table if not exists public.sales_orders (
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 order_number text not null,client_id uuid references public.clients(id) on delete set null,client_name text not null,
 currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),status text not null default 'draft' check(status in ('draft','confirmed','partially_fulfilled','fulfilled','cancelled')),
 order_date date not null default current_date,expected_date date,subtotal numeric(18,4) not null default 0,tax_total numeric(18,4) not null default 0,total numeric(18,4) not null default 0,
 notes text,idempotency_key uuid not null,created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,order_number),unique(workspace_id,idempotency_key),check(expected_date is null or expected_date>=order_date)
);
create table if not exists public.sales_order_items (
 id uuid primary key default gen_random_uuid(),workspace_id text not null,sales_order_id uuid not null,
 stock_id uuid references public.stock(id) on delete set null,description text not null check(length(btrim(description)) between 1 and 300),
 quantity numeric(18,4) not null check(quantity>0),unit_price numeric(18,4) not null check(unit_price>=0),tax_rate numeric(8,4) not null default 0 check(tax_rate between 0 and 100),
 line_subtotal numeric(18,4) not null,line_tax numeric(18,4) not null,line_total numeric(18,4) not null,
 unique(workspace_id,id),foreign key(workspace_id,sales_order_id) references public.sales_orders(workspace_id,id) on delete cascade
);
create table if not exists public.delivery_challans (
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 challan_number text not null,sales_order_id uuid not null,client_name text not null,dispatch_date date not null default current_date,
 status text not null default 'draft' check(status in ('draft','dispatched','received','cancelled')),notes text,idempotency_key uuid not null,
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,challan_number),unique(workspace_id,idempotency_key),
 foreign key(workspace_id,sales_order_id) references public.sales_orders(workspace_id,id) on delete restrict
);
create table if not exists public.delivery_challan_items (
 id uuid primary key default gen_random_uuid(),workspace_id text not null,delivery_challan_id uuid not null,sales_order_item_id uuid not null,
 stock_id uuid references public.stock(id) on delete set null,description text not null,quantity numeric(18,4) not null check(quantity>0),
 foreign key(workspace_id,delivery_challan_id) references public.delivery_challans(workspace_id,id) on delete cascade,
 foreign key(workspace_id,sales_order_item_id) references public.sales_order_items(workspace_id,id) on delete restrict
);
create table if not exists public.credit_debit_notes (
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 note_number text not null,invoice_id uuid not null references public.invoices(id) on delete restrict,
 note_type text not null check(note_type in ('credit','debit')),reason text not null check(length(btrim(reason)) between 3 and 1000),
 amount numeric(18,4) not null check(amount>0),currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),
 status text not null default 'draft' check(status in ('draft','issued','cancelled')),idempotency_key uuid not null,
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,note_number),unique(workspace_id,idempotency_key)
);
create index if not exists sales_orders_workspace_status_idx on public.sales_orders(workspace_id,status,order_date desc);
create index if not exists sales_order_items_order_idx on public.sales_order_items(workspace_id,sales_order_id);
create index if not exists delivery_challans_workspace_status_idx on public.delivery_challans(workspace_id,status,dispatch_date desc);
create index if not exists delivery_challan_items_challan_idx on public.delivery_challan_items(workspace_id,delivery_challan_id);
create index if not exists credit_debit_notes_invoice_idx on public.credit_debit_notes(workspace_id,invoice_id,status);
do $$ declare t text; begin
 foreach t in array array['sales_orders','sales_order_items','delivery_challans','delivery_challan_items','credit_debit_notes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy %I on public.%I for all to anon,authenticated using(false) with check(false)',t||'_deny_client_access',t);
 end loop;
end $$;

create or replace function public.main_workspace_create_sales_order(p_workspace_id text,p_client_id uuid,p_client_name text,p_items jsonb,p_expected_date date default null,p_notes text default null,p_idempotency_key uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_currency text;v_order public.sales_orders%rowtype;v_item jsonb;v_qty numeric;v_price numeric;v_tax numeric;v_sub numeric:=0;v_tax_total numeric:=0;v_line_sub numeric;v_line_tax numeric;v_desc text;v_stock uuid;v_number text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if nullif(btrim(p_client_name),'') is null or length(p_client_name)>200 or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>200 or p_idempotency_key is null then return jsonb_build_object('ok',false,'reason','invalid_order'); end if;
 select currency_code into v_currency from public.workspace_settings where workspace_id=p_workspace_id;
 if v_currency is null or v_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('ok',false,'reason','workspace_currency_not_ready'); end if;
 if p_client_id is not null and not exists(select 1 from public.clients where id=p_client_id and workspace_id=p_workspace_id) then return jsonb_build_object('ok',false,'reason','client_not_found'); end if;
 if exists(select 1 from public.sales_orders where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key) then select * into v_order from public.sales_orders where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;return jsonb_build_object('ok',true,'sales_order_id',v_order.id,'duplicate',true); end if;
 v_number:='SO-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.sales_orders(workspace_id,order_number,client_id,client_name,currency_code,expected_date,notes,idempotency_key,created_by) values(p_workspace_id,v_number,p_client_id,btrim(p_client_name),v_currency,p_expected_date,nullif(btrim(p_notes),''),p_idempotency_key,v_user) returning * into v_order;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_desc:=nullif(btrim(v_item->>'description'),'');v_qty:=coalesce((v_item->>'quantity')::numeric,0);v_price:=coalesce((v_item->>'unit_price')::numeric,-1);v_tax:=coalesce((v_item->>'tax_rate')::numeric,0);v_stock:=nullif(v_item->>'stock_id','')::uuid;
  if v_desc is null or length(v_desc)>300 or v_qty<=0 or v_price<0 or v_tax<0 or v_tax>100 or round(v_qty,4)<>v_qty or round(v_price,4)<>v_price then raise exception 'invalid_sales_order_item'; end if;
  if v_stock is not null and not exists(select 1 from public.stock where id=v_stock and workspace_id=p_workspace_id) then raise exception 'stock_item_not_found'; end if;
  v_line_sub:=round(v_qty*v_price,4);v_line_tax:=round(v_line_sub*v_tax/100,4);
  insert into public.sales_order_items(workspace_id,sales_order_id,stock_id,description,quantity,unit_price,tax_rate,line_subtotal,line_tax,line_total) values(p_workspace_id,v_order.id,v_stock,v_desc,v_qty,v_price,v_tax,v_line_sub,v_line_tax,v_line_sub+v_line_tax);
  v_sub:=v_sub+v_line_sub;v_tax_total:=v_tax_total+v_line_tax;
 end loop;
 update public.sales_orders set subtotal=v_sub,tax_total=v_tax_total,total=v_sub+v_tax_total,updated_at=now() where id=v_order.id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'sales_order.created','sales_order',v_order.id::text,jsonb_build_object('order_number',v_number,'total',v_sub+v_tax_total,'currency_code',v_currency));
 return jsonb_build_object('ok',true,'sales_order_id',v_order.id,'order_number',v_number,'total',v_sub+v_tax_total,'currency_code',v_currency);
exception when others then if sqlerrm in ('invalid_sales_order_item','stock_item_not_found') then return jsonb_build_object('ok',false,'reason',sqlerrm); end if; raise;
end; $function$;

create or replace function public.main_workspace_create_delivery_challan(p_workspace_id text,p_sales_order_id uuid,p_items jsonb,p_idempotency_key uuid,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_order public.sales_orders%rowtype;v_challan public.delivery_challans%rowtype;v_item jsonb;v_order_item public.sales_order_items%rowtype;v_qty numeric;v_done numeric;v_number text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_idempotency_key is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>200 then return jsonb_build_object('ok',false,'reason','invalid_challan'); end if;
 if exists(select 1 from public.delivery_challans where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key) then select * into v_challan from public.delivery_challans where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;return jsonb_build_object('ok',true,'delivery_challan_id',v_challan.id,'duplicate',true); end if;
 select * into v_order from public.sales_orders where workspace_id=p_workspace_id and id=p_sales_order_id for update;
 if not found or v_order.status not in ('confirmed','partially_fulfilled') then return jsonb_build_object('ok',false,'reason','sales_order_not_confirmed'); end if;
 v_number:='DC-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.delivery_challans(workspace_id,challan_number,sales_order_id,client_name,idempotency_key,notes,created_by) values(p_workspace_id,v_number,v_order.id,v_order.client_name,p_idempotency_key,nullif(btrim(p_notes),''),v_user) returning * into v_challan;
 for v_item in select value from jsonb_array_elements(p_items) loop
  select * into v_order_item from public.sales_order_items where workspace_id=p_workspace_id and id=(v_item->>'sales_order_item_id')::uuid and sales_order_id=v_order.id for update;
  if not found then raise exception 'sales_order_item_not_found'; end if;
  v_qty:=coalesce((v_item->>'quantity')::numeric,0);
  select coalesce(sum(dci.quantity),0) into v_done from public.delivery_challan_items dci join public.delivery_challans dc on dc.id=dci.delivery_challan_id where dci.workspace_id=p_workspace_id and dci.sales_order_item_id=v_order_item.id and dc.status in ('dispatched','received');
  if v_qty<=0 or v_qty+v_done>v_order_item.quantity then raise exception 'challan_quantity_exceeds_order'; end if;
  insert into public.delivery_challan_items(workspace_id,delivery_challan_id,sales_order_item_id,stock_id,description,quantity) values(p_workspace_id,v_challan.id,v_order_item.id,v_order_item.stock_id,v_order_item.description,v_qty);
 end loop;
 update public.sales_orders set status='partially_fulfilled',updated_at=now() where id=v_order.id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'delivery_challan.created','delivery_challan',v_challan.id::text,jsonb_build_object('challan_number',v_number,'sales_order_id',v_order.id));
 return jsonb_build_object('ok',true,'delivery_challan_id',v_challan.id,'challan_number',v_number);
exception when others then if sqlerrm in ('sales_order_item_not_found','challan_quantity_exceeds_order') then return jsonb_build_object('ok',false,'reason',sqlerrm); end if; raise;
end; $function$;

create or replace function public.main_workspace_create_credit_debit_note(p_workspace_id text,p_invoice_id uuid,p_note_type text,p_reason text,p_amount numeric,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_invoice public.invoices%rowtype;v_note public.credit_debit_notes%rowtype;v_credited numeric;v_doc_type text;v_number text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_note_type not in ('credit','debit') or nullif(btrim(p_reason),'') is null or length(p_reason)>1000 or p_amount is null or p_amount<=0 or p_idempotency_key is null then return jsonb_build_object('ok',false,'reason','invalid_note'); end if;
 select * into v_invoice from public.invoices where workspace_id=p_workspace_id and id=p_invoice_id for share;
 if not found or v_invoice.is_draft or lower(v_invoice.status) in ('draft','cancelled','void') then return jsonb_build_object('ok',false,'reason','source_invoice_not_issued'); end if;
 if exists(select 1 from public.credit_debit_notes where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key) then select * into v_note from public.credit_debit_notes where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;return jsonb_build_object('ok',true,'note_id',v_note.id,'duplicate',true); end if;
 if p_note_type='credit' then select coalesce(sum(amount),0) into v_credited from public.credit_debit_notes where workspace_id=p_workspace_id and invoice_id=p_invoice_id and note_type='credit' and status='issued'; if v_credited+p_amount>v_invoice.total then return jsonb_build_object('ok',false,'reason','credit_exceeds_remaining_invoice_total'); end if; end if;
 v_doc_type:=case p_note_type when 'credit' then 'CN' else 'DN' end;v_number:=v_doc_type||'-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.credit_debit_notes(workspace_id,note_number,invoice_id,note_type,reason,amount,currency_code,idempotency_key,created_by) values(p_workspace_id,v_number,p_invoice_id,p_note_type,btrim(p_reason),p_amount,v_invoice.currency,p_idempotency_key,v_user) returning * into v_note;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,p_note_type||'_note.created',p_note_type||'_note',v_note.id::text,jsonb_build_object('invoice_id',p_invoice_id,'amount',p_amount,'currency_code',v_invoice.currency));
 return jsonb_build_object('ok',true,'note_id',v_note.id,'note_number',v_number,'currency_code',v_invoice.currency);
end; $function$;

create or replace function public.main_workspace_set_sales_document_status(p_workspace_id text,p_document_type text,p_document_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_found uuid;v_amount numeric;v_invoice uuid;v_credited numeric;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_document_type='sales_order' and p_status in ('confirmed','cancelled','fulfilled') then
  update public.sales_orders set status=p_status,updated_at=now() where workspace_id=p_workspace_id and id=p_document_id and ((p_status='confirmed' and status='draft') or (p_status='cancelled' and status in ('draft','confirmed','partially_fulfilled')) or (p_status='fulfilled' and status='partially_fulfilled')) returning id into v_found;
 elsif p_document_type='delivery_challan' and p_status in ('dispatched','received','cancelled') then
  update public.delivery_challans set status=p_status,updated_at=now() where workspace_id=p_workspace_id and id=p_document_id and ((p_status='dispatched' and status='draft') or (p_status='received' and status='dispatched') or (p_status='cancelled' and status in ('draft','dispatched'))) returning id into v_found;
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
revoke all on function public.main_workspace_create_sales_order(text,uuid,text,jsonb,date,text,uuid) from public,anon;
revoke all on function public.main_workspace_create_delivery_challan(text,uuid,jsonb,uuid,text) from public,anon;
revoke all on function public.main_workspace_create_credit_debit_note(text,uuid,text,text,numeric,uuid) from public,anon;
revoke all on function public.main_workspace_set_sales_document_status(text,text,uuid,text) from public,anon;
grant execute on function public.main_workspace_create_sales_order(text,uuid,text,jsonb,date,text,uuid) to authenticated;
grant execute on function public.main_workspace_create_delivery_challan(text,uuid,jsonb,uuid,text) to authenticated;
grant execute on function public.main_workspace_create_credit_debit_note(text,uuid,text,text,numeric,uuid) to authenticated;
grant execute on function public.main_workspace_set_sales_document_status(text,text,uuid,text) to authenticated;
commit;
