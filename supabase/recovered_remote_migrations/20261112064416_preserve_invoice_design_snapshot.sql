ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_snapshot jsonb;

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
  _snapshot jsonb := _data->'invoice_snapshot';
  _n integer;
BEGIN
  SELECT workspace_id, role INTO _ws, _role FROM public.profiles WHERE id = auth.uid();
  IF _ws IS NULL OR _role NOT IN ('admin','manager','employee') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(_items,'null')) <> 'array' OR jsonb_array_length(_items) > 500 THEN
    RAISE EXCEPTION 'invalid items' USING ERRCODE = '22023';
  END IF;
  IF _snapshot IS NOT NULL AND (jsonb_typeof(_snapshot) <> 'object' OR octet_length(_snapshot::text) > 2000000) THEN
    RAISE EXCEPTION 'invalid invoice snapshot' USING ERRCODE = '22023';
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
    total = GREATEST(0, _taxable + _tax),
    invoice_snapshot = COALESCE(_snapshot, invoice_snapshot),
    updated_at = now()
  WHERE id = _inv.id RETURNING * INTO _inv;

  IF NOT _inv.is_draft AND NOT _inv.stock_applied THEN
    UPDATE public.stock s SET quantity = GREATEST(0, s.quantity - q.qty)
    FROM (
      SELECT lower(trim(description)) d, sum(GREATEST(0, quantity)) qty
      FROM public.invoice_items WHERE invoice_id = _inv.id GROUP BY 1
    ) q
    WHERE s.workspace_id = _ws AND lower(trim(s.name)) = q.d;
    UPDATE public.invoices SET stock_applied = true WHERE id = _inv.id RETURNING * INTO _inv;
  END IF;
  RETURN _inv;
END $$;
