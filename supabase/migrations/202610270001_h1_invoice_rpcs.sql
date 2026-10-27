-- H1 invoice RPC migration.
-- Adapted from the supplied original migration to the live Plivex schema.
-- Apply only after reviewing the migration branch; it is not applied to production here.

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
BEGIN
  SELECT workspace_id, role INTO _ws, _role FROM public.profiles WHERE id = auth.uid();
  IF _ws IS NULL OR _role NOT IN ('admin','manager','employee') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(_items,'null')) <> 'array' OR jsonb_array_length(_items) > 500 THEN
    RAISE EXCEPTION 'invalid items' USING ERRCODE = '22023';
  END IF;
  IF _status NOT IN ('Pending','Paid') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  IF _dtype NOT IN ('percent','flat') OR _mode NOT IN ('split','igst') OR _rate < 0 OR _rate > 100 OR _disc < 0 THEN
    RAISE EXCEPTION 'invalid invoice totals' USING ERRCODE = '22023';
  END IF;

  FOR _it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _subtotal := _subtotal + GREATEST(0, COALESCE((_it->>'quantity')::numeric,0)) * GREATEST(0, COALESCE((_it->>'rate')::numeric,0));
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
    COALESCE((e->>'quantity')::numeric,0), COALESCE((e->>'rate')::numeric,0), (e->>'gst_rate')::numeric
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

CREATE OR REPLACE FUNCTION public.cancel_invoice(_invoice_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _inv public.invoices;
BEGIN
  UPDATE public.invoices SET status = 'Cancelled', updated_at = now()
  WHERE id = _invoice_id AND public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[])
  RETURNING * INTO _inv;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'not found or forbidden' USING ERRCODE = '42501'; END IF;
  RETURN _inv;
END $$;

CREATE OR REPLACE FUNCTION public.delete_draft_invoice(_invoice_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _ws text;
BEGIN
  SELECT workspace_id INTO _ws FROM public.profiles WHERE id = auth.uid();
  DELETE FROM public.invoices WHERE id = _invoice_id AND workspace_id = _ws AND is_draft
    AND public.has_ws_role(workspace_id, ARRAY['admin']::public.app_role[]);
  IF NOT FOUND THEN RAISE EXCEPTION 'only admins can delete draft invoices' USING ERRCODE = '42501'; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.revenue_summary(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE (invoice_count bigint, revenue numeric, paid numeric, pending numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*), COALESCE(sum(i.total),0),
    COALESCE(sum(i.total) FILTER (WHERE i.status='Paid'),0),
    COALESCE(sum(i.total) FILTER (WHERE i.status='Pending'),0)
  FROM public.invoices i
  JOIN public.profiles p ON p.id = auth.uid() AND p.workspace_id = i.workspace_id
  WHERE i.status <> 'Cancelled' AND NOT i.is_draft
    AND p.role = ANY(ARRAY['admin','manager','accountant']::public.app_role[])
    AND (_from IS NULL OR i.issue_date >= _from) AND (_to IS NULL OR i.issue_date <= _to)
$$;

REVOKE ALL ON FUNCTION public.save_invoice(jsonb,jsonb,uuid), public.cancel_invoice(uuid),
  public.delete_draft_invoice(uuid), public.revenue_summary(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_invoice(jsonb,jsonb,uuid), public.cancel_invoice(uuid),
  public.delete_draft_invoice(uuid), public.revenue_summary(date,date) TO authenticated;
