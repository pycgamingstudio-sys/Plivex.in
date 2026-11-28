-- Persist the India HSN/SAC and UQC metadata used by IRP invoice preparation.
begin;
create or replace function public.save_invoice(_data jsonb, _items jsonb, _invoice_id uuid default null)
returns public.invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  _ws text;
  _role public.app_role;
  _inv public.invoices;
  _it jsonb;
  _subtotal numeric := 0;
  _dv numeric;
  _tax numeric := 0;
  _taxable numeric;
  _isub numeric;
  _rate numeric := coalesce((_data->>'tax_rate')::numeric, 0);
  _dtype text := coalesce(_data->>'discount_type', 'percent');
  _disc numeric := coalesce((_data->>'discount')::numeric, 0);
  _mode text := coalesce(_data->>'tax_mode', 'split');
  _draft boolean := coalesce((_data->>'is_draft')::boolean, false);
  _status text := coalesce(_data->>'status', 'Pending');
  _n integer;
  _warehouse uuid;
begin
  select workspace_id, role into _ws, _role from public.profiles where id = auth.uid();
  if _ws is null or _role not in ('admin','manager','employee') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(_items,'null')) <> 'array' or jsonb_array_length(_items) > 500 then
    raise exception 'invalid items' using errcode = '22023';
  end if;
  if _status not in ('Pending','Paid') then raise exception 'invalid status' using errcode = '22023'; end if;
  if _dtype not in ('percent','flat') or _mode not in ('split','igst') or _rate < 0 or _rate > 100 or _disc < 0 or (_dtype = 'percent' and _disc > 100) then
    raise exception 'invalid invoice totals' using errcode = '22023';
  end if;

  for _it in select * from jsonb_array_elements(_items) loop
    if coalesce((_it->>'quantity')::numeric,0) < 0 or coalesce((_it->>'rate')::numeric,0) < 0
      or coalesce((_it->>'gst_rate')::numeric,0) < 0 or coalesce((_it->>'gst_rate')::numeric,0) > 100
      or (nullif(_it->>'hsn_sac_code','') is not null and (_it->>'hsn_sac_code') !~ '^[0-9]{4,8}$')
      or coalesce(nullif(_it->>'unit_code',''),'OTH') !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'invalid invoice item' using errcode = '22023';
    end if;
    _subtotal := _subtotal + coalesce((_it->>'quantity')::numeric,0) * coalesce((_it->>'rate')::numeric,0);
  end loop;
  _dv := case when _dtype = 'percent' then _subtotal * least(_disc,100) / 100 else least(_disc,_subtotal) end;
  _taxable := greatest(0, _subtotal - _dv);
  for _it in select * from jsonb_array_elements(_items) loop
    _isub := greatest(0, coalesce((_it->>'quantity')::numeric,0)) * greatest(0, coalesce((_it->>'rate')::numeric,0));
    _tax := _tax + (_isub - case when _subtotal > 0 then _isub / _subtotal * _dv else 0 end)
      * coalesce(nullif((_it->>'gst_rate')::numeric, 0), _rate) / 100;
  end loop;

  if _invoice_id is null then
    insert into public.invoice_counters (workspace_id, last_number) values (_ws, 1)
      on conflict (workspace_id) do update set last_number = public.invoice_counters.last_number + 1
      returning last_number into _n;
    insert into public.invoices (workspace_id, created_by, number)
      values (_ws, auth.uid(), 'INV-' || lpad(_n::text, 3, '0')) returning * into _inv;
  else
    select * into _inv from public.invoices where id = _invoice_id and workspace_id = _ws for update;
    if _inv.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
    if _inv.status = 'Cancelled' then raise exception 'invoice cancelled' using errcode = '55000'; end if;
    if _role = 'employee' and not (_inv.is_draft and _inv.created_by = auth.uid()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if _inv.stock_applied then
      if not exists (select 1 from public.invoice_stock_allocations where workspace_id=_ws and invoice_id=_inv.id) then
        raise exception 'legacy_stock_allocation_unavailable';
      end if;
      perform public.reverse_invoice_stock(_inv.id, _ws, auth.uid());
      update public.invoices set stock_applied=false,stock_reversed=true where id=_inv.id returning * into _inv;
    end if;
    delete from public.invoice_items where invoice_id = _inv.id;
  end if;

  insert into public.invoice_items (invoice_id, description, quantity, rate, gst_rate, hsn_sac_code, unit_code)
  select _inv.id, left(coalesce(e->>'description',''), 500),
    greatest(0, coalesce((e->>'quantity')::numeric,0)), greatest(0, coalesce((e->>'rate')::numeric,0)),
    (e->>'gst_rate')::numeric, nullif(e->>'hsn_sac_code',''), coalesce(nullif(e->>'unit_code',''),'OTH')
  from jsonb_array_elements(_items) e;

  update public.invoices set
    client_name = _data->>'client_name', client_email = _data->>'client_email', business_name = _data->>'business_name',
    issue_date = coalesce((_data->>'issue_date')::date, issue_date), due_date = (_data->>'due_date')::date,
    currency = coalesce(_data->>'currency','INR'), tax_mode = _mode, tax_rate = _rate,
    discount_type = _dtype, discount = _disc, notes = _data->>'notes', terms = _data->>'terms',
    status = _status, is_draft = _draft,
    subtotal = _subtotal, tax_value = _tax,
    cgst = case when _mode = 'split' then _tax / 2 else 0 end,
    sgst = case when _mode = 'split' then _tax / 2 else 0 end,
    igst = case when _mode = 'igst' then _tax else 0 end,
    total = greatest(0, _taxable + _tax), updated_at = now()
  where id = _inv.id returning * into _inv;

  if not _inv.is_draft and not _inv.stock_applied then
    _warehouse := nullif(_data->>'warehouse_id','')::uuid;
    perform public.apply_invoice_stock(_inv.id,_ws,_warehouse,auth.uid());
    update public.invoices set stock_applied=true,stock_reversed=false where id=_inv.id returning * into _inv;
  end if;
  return _inv;
end $function$;

revoke all on function public.save_invoice(jsonb,jsonb,uuid) from public,anon;
grant execute on function public.save_invoice(jsonb,jsonb,uuid) to authenticated;
commit;
