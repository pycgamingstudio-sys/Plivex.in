-- Record exactly which stock rows and batches each invoice consumed.
alter table public.invoices add column if not exists stock_reversed boolean not null default false;
create table if not exists public.invoice_stock_allocations (
 id uuid primary key default gen_random_uuid(),
 workspace_id text not null,
 invoice_id uuid not null references public.invoices(id) on delete cascade,
 invoice_item_id uuid not null references public.invoice_items(id) on delete cascade,
 stock_id uuid not null,
 batch_id uuid,
 quantity numeric(18,4) not null check(quantity>0),
 reversed_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,stock_id) references public.stock(workspace_id,id) on delete restrict,
 foreign key(batch_id) references public.inventory_batches(id) on delete restrict
);
create index if not exists invoice_stock_allocations_active_idx on public.invoice_stock_allocations(workspace_id,invoice_id) where reversed_at is null;
alter table public.invoice_stock_allocations enable row level security;
drop policy if exists "invoice stock allocations read" on public.invoice_stock_allocations;
create policy "invoice stock allocations read" on public.invoice_stock_allocations for select to authenticated
 using(public.has_ws_role(workspace_id,ARRAY['admin'::public.app_role,'manager'::public.app_role,'accountant'::public.app_role]));
grant select on public.invoice_stock_allocations to authenticated;

create or replace function public.apply_invoice_stock(p_invoice_id uuid,p_workspace_id text,p_warehouse_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
 v_warehouse uuid:=p_warehouse_id;
 v_item record;
 v_stock public.stock%rowtype;
 v_batch public.inventory_batches%rowtype;
 v_remaining numeric(18,4);
 v_take numeric(18,4);
 v_batch_remaining numeric(18,4);
 v_batch_take numeric(18,4);
 v_has_batches boolean;
begin
 if v_warehouse is null then
   select id into v_warehouse from public.warehouses where workspace_id=p_workspace_id and is_default=true and is_active limit 1;
 end if;
 if v_warehouse is null then return; end if;
 if not exists(select 1 from public.warehouses where workspace_id=p_workspace_id and id=v_warehouse and is_active) then
   raise exception 'invoice_warehouse_not_found';
 end if;
 for v_item in
   select id,lower(trim(description)) as product_name,quantity
   from public.invoice_items where invoice_id=p_invoice_id order by id
 loop
   if v_item.quantity<=0 then continue; end if;
   if not exists(select 1 from public.stock where workspace_id=p_workspace_id and lower(trim(name))=v_item.product_name) then
     continue;
   end if;
   if not exists(select 1 from public.stock where workspace_id=p_workspace_id and warehouse_id=v_warehouse and lower(trim(name))=v_item.product_name) then
     raise exception 'stock_warehouse_mismatch';
   end if;
   v_remaining:=v_item.quantity;
   for v_stock in
     select * from public.stock
     where workspace_id=p_workspace_id and warehouse_id=v_warehouse and lower(trim(name))=v_item.product_name
     order by created_at,id for update
   loop
     exit when v_remaining<=0;
     v_take:=least(v_stock.quantity,v_remaining);
     if v_take<=0 then continue; end if;
     select exists(select 1 from public.inventory_batches where workspace_id=p_workspace_id and stock_id=v_stock.id and quantity>0)
       into v_has_batches;
     if v_has_batches then
       v_batch_remaining:=v_take;
       for v_batch in
         select * from public.inventory_batches
         where workspace_id=p_workspace_id and stock_id=v_stock.id and quantity>0
           and (expires_on is null or expires_on>=current_date)
         order by expires_on nulls last,created_at,id for update
       loop
         exit when v_batch_remaining<=0;
         v_batch_take:=least(v_batch.quantity,v_batch_remaining);
         update public.inventory_batches set quantity=quantity-v_batch_take where id=v_batch.id;
         insert into public.invoice_stock_allocations(workspace_id,invoice_id,invoice_item_id,stock_id,batch_id,quantity)
         values(p_workspace_id,p_invoice_id,v_item.id,v_stock.id,v_batch.id,v_batch_take);
         v_batch_remaining:=v_batch_remaining-v_batch_take;
       end loop;
       if v_batch_remaining>0 then raise exception 'insufficient_batch_stock'; end if;
     else
       insert into public.invoice_stock_allocations(workspace_id,invoice_id,invoice_item_id,stock_id,batch_id,quantity)
       values(p_workspace_id,p_invoice_id,v_item.id,v_stock.id,null,v_take);
     end if;
     update public.stock set quantity=quantity-v_take,updated_at=now() where id=v_stock.id;
     insert into public.stock_movements(workspace_id,warehouse_id,stock_id,movement_type,quantity_delta,reference_type,reference_id,idempotency_key,notes,created_by)
     values(p_workspace_id,v_warehouse,v_stock.id,'sale',-v_take,'invoice',p_invoice_id,gen_random_uuid(),'Invoice stock deduction',p_user_id);
     v_remaining:=v_remaining-v_take;
   end loop;
   if v_remaining>0 then raise exception 'insufficient_stock'; end if;
 end loop;
end $$;

create or replace function public.reverse_invoice_stock(p_invoice_id uuid,p_workspace_id text,p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_allocation public.invoice_stock_allocations%rowtype; v_warehouse uuid;
begin
 for v_allocation in
   select * from public.invoice_stock_allocations
   where workspace_id=p_workspace_id and invoice_id=p_invoice_id and reversed_at is null
   order by created_at,id for update
 loop
   select warehouse_id into v_warehouse from public.stock where workspace_id=p_workspace_id and id=v_allocation.stock_id for update;
   update public.stock set quantity=quantity+v_allocation.quantity,updated_at=now()
   where workspace_id=p_workspace_id and id=v_allocation.stock_id;
   if v_allocation.batch_id is not null then
     update public.inventory_batches set quantity=quantity+v_allocation.quantity where id=v_allocation.batch_id;
   end if;
   insert into public.stock_movements(workspace_id,warehouse_id,stock_id,movement_type,quantity_delta,reference_type,reference_id,idempotency_key,notes,created_by)
   values(p_workspace_id,v_warehouse,v_allocation.stock_id,'return',v_allocation.quantity,'invoice_cancel',p_invoice_id,gen_random_uuid(),'Invoice cancellation stock reversal',p_user_id);
   update public.invoice_stock_allocations set reversed_at=now() where id=v_allocation.id;
 end loop;
end $$;

revoke all on function public.apply_invoice_stock(uuid,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.reverse_invoice_stock(uuid,text,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_invoice(_data jsonb, _items jsonb, _invoice_id uuid DEFAULT NULL)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _ws text;
  _role public.app_role;
  _inv public.invoices;
  _it jsonb;
  _subtotal numeric := 0;
  _dv numeric;
  _tax numeric := 0;
  _taxable numeric;
  _isub numeric;
  _rate numeric := COALESCE((_data->>'tax_rate')::numeric, 0);
  _dtype text := COALESCE(_data->>'discount_type', 'percent');
  _disc numeric := COALESCE((_data->>'discount')::numeric, 0);
  _mode text := COALESCE(_data->>'tax_mode', 'split');
  _draft boolean := COALESCE((_data->>'is_draft')::boolean, false);
  _status text := COALESCE(_data->>'status', 'Pending');
  _n integer;
  _warehouse uuid;
BEGIN
  SELECT workspace_id, role INTO _ws, _role FROM public.profiles WHERE id = auth.uid();
  IF _ws IS NULL OR _role NOT IN ('admin','manager','employee') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(_items,'null')) <> 'array' OR jsonb_array_length(_items) > 500 THEN
    RAISE EXCEPTION 'invalid items' USING ERRCODE = '22023';
  END IF;
  IF _status NOT IN ('Pending','Paid') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  IF _dtype NOT IN ('percent','flat') OR _mode NOT IN ('split','igst') OR _rate < 0 OR _rate > 100 OR _disc < 0 OR (_dtype = 'percent' AND _disc > 100) THEN
    RAISE EXCEPTION 'invalid invoice totals' USING ERRCODE = '22023';
  END IF;

  FOR _it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    IF COALESCE((_it->>'quantity')::numeric,0) < 0 OR COALESCE((_it->>'rate')::numeric,0) < 0
      OR COALESCE((_it->>'gst_rate')::numeric,0) < 0 OR COALESCE((_it->>'gst_rate')::numeric,0) > 100 THEN
      RAISE EXCEPTION 'invalid invoice item' USING ERRCODE = '22023';
    END IF;
    _subtotal := _subtotal + COALESCE((_it->>'quantity')::numeric,0) * COALESCE((_it->>'rate')::numeric,0);
  END LOOP;
  _dv := CASE WHEN _dtype = 'percent' THEN _subtotal * LEAST(_disc,100) / 100 ELSE LEAST(_disc,_subtotal) END;
  _taxable := GREATEST(0, _subtotal - _dv);
  FOR _it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _isub := GREATEST(0, COALESCE((_it->>'quantity')::numeric,0)) * GREATEST(0, COALESCE((_it->>'rate')::numeric,0));
    _tax := _tax + (_isub - CASE WHEN _subtotal > 0 THEN _isub / _subtotal * _dv ELSE 0 END)
      * COALESCE(NULLIF((_it->>'gst_rate')::numeric, 0), _rate) / 100;
  END LOOP;

  IF _invoice_id IS NULL THEN
    INSERT INTO public.invoice_counters (workspace_id, last_number) VALUES (_ws, 1)
      ON CONFLICT (workspace_id) DO UPDATE SET last_number = public.invoice_counters.last_number + 1
      RETURNING last_number INTO _n;
    INSERT INTO public.invoices (workspace_id, created_by, number)
      VALUES (_ws, auth.uid(), 'INV-' || lpad(_n::text, 3, '0')) RETURNING * INTO _inv;
  ELSE
    SELECT * INTO _inv FROM public.invoices WHERE id = _invoice_id AND workspace_id = _ws FOR UPDATE;
    IF _inv.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
    IF _inv.status = 'Cancelled' THEN RAISE EXCEPTION 'invoice cancelled' USING ERRCODE = '55000'; END IF;
    IF _role = 'employee' AND NOT (_inv.is_draft AND _inv.created_by = auth.uid()) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF _inv.stock_applied THEN
      IF NOT EXISTS (SELECT 1 FROM public.invoice_stock_allocations WHERE workspace_id=_ws AND invoice_id=_inv.id) THEN
        RAISE EXCEPTION 'legacy_stock_allocation_unavailable';
      END IF;
      PERFORM public.reverse_invoice_stock(_inv.id, _ws, auth.uid());
      UPDATE public.invoices SET stock_applied=false,stock_reversed=true WHERE id=_inv.id RETURNING * INTO _inv;
    END IF;
    DELETE FROM public.invoice_items WHERE invoice_id = _inv.id;
  END IF;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, rate, gst_rate)
  SELECT _inv.id, left(COALESCE(e->>'description',''), 500),
    GREATEST(0, COALESCE((e->>'quantity')::numeric,0)), GREATEST(0, COALESCE((e->>'rate')::numeric,0)), (e->>'gst_rate')::numeric
  FROM jsonb_array_elements(_items) e;

  UPDATE public.invoices SET
    client_name = _data->>'client_name', client_email = _data->>'client_email', business_name = _data->>'business_name',
    issue_date = COALESCE((_data->>'issue_date')::date, issue_date), due_date = (_data->>'due_date')::date,
    currency = COALESCE(_data->>'currency','INR'), tax_mode = _mode, tax_rate = _rate,
    discount_type = _dtype, discount = _disc, notes = _data->>'notes', terms = _data->>'terms',
    status = _status, is_draft = _draft,
    subtotal = _subtotal, tax_value = _tax,
    cgst = CASE WHEN _mode = 'split' THEN _tax / 2 ELSE 0 END,
    sgst = CASE WHEN _mode = 'split' THEN _tax / 2 ELSE 0 END,
    igst = CASE WHEN _mode = 'igst' THEN _tax ELSE 0 END,
    total = GREATEST(0, _taxable + _tax), updated_at = now()
  WHERE id = _inv.id RETURNING * INTO _inv;

  IF NOT _inv.is_draft AND NOT _inv.stock_applied THEN
    _warehouse := NULLIF(_data->>'warehouse_id','')::uuid;
    PERFORM public.apply_invoice_stock(_inv.id,_ws,_warehouse,auth.uid());
    UPDATE public.invoices SET stock_applied=true,stock_reversed=false WHERE id=_inv.id RETURNING * INTO _inv;
  END IF;
  RETURN _inv;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_invoice(_invoice_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _inv public.invoices;
  _ws text;
BEGIN
  SELECT workspace_id INTO _ws FROM public.profiles WHERE id=auth.uid();
  IF _ws IS NULL OR NOT public.has_ws_role(_ws, ARRAY['admin','manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'not found or forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO _inv FROM public.invoices WHERE id=_invoice_id AND workspace_id=_ws FOR UPDATE;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'not found or forbidden' USING ERRCODE='42501'; END IF;
  IF _inv.status='Cancelled' THEN RETURN _inv; END IF;
  IF _inv.stock_applied AND NOT _inv.stock_reversed THEN
    PERFORM public.reverse_invoice_stock(_inv.id,_ws,auth.uid());
  END IF;
  UPDATE public.invoices SET status='Cancelled',
    stock_reversed=case when stock_applied then true else stock_reversed end,
    updated_at=now()
  WHERE id=_invoice_id AND workspace_id=_ws RETURNING * INTO _inv;
  RETURN _inv;
END $$;

REVOKE ALL ON FUNCTION public.save_invoice(jsonb,jsonb,uuid), public.cancel_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_invoice(jsonb,jsonb,uuid), public.cancel_invoice(uuid) TO authenticated;

