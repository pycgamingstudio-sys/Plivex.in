-- Forward-only hardening of global invoice tax snapshots and treatment policy.
-- Registration metadata is reconstructed from the authenticated workspace business_profile.
-- Global invoice tax integration. Apply only after separate deployment authorization.
-- Server-side calculation and invoice totals are reconciled against workspace tax profile
-- and the versioned tax snapshot. No live Supabase migration is performed by this commit.
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
  _global_tax boolean := false;
  _global_country text;
  _global_mode text;
  _global_price_mode text;
  _global_rate numeric := 0;
  _global_total numeric := 0;
  _expected_currency text;
  _expected_rate_bps integer;
  _expected_rule_id text;
  _business public.business_profile%ROWTYPE;
  _component jsonb;
  _component_count integer := 0;
  _component_index integer := 0;
  _expected_component_minor numeric := 0;
  _expected_taxable_minor numeric := 0;
  _expected_tax_minor numeric := 0;
  _components_total_minor numeric := 0;
  _global_gross numeric := 0;
  _issue_date date := COALESCE((_data->>'issue_date')::date, CURRENT_DATE);
  _destination_region text;
  _registered_region text;
  _seller_region text;
  _manual_tax_treatment text;
  _legal_effective_from date;
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

  SELECT * INTO _business FROM public.business_profile WHERE workspace_id = _ws LIMIT 1;
  _global_country := upper(coalesce(_snapshot->'globalTax'->>'countryCode', _snapshot->'globalTaxCalculation'->>'countryCode', ''));
  _global_tax := _global_country IN ('US','GB','AE','CA','AU','SG')
    AND coalesce((_snapshot->'globalTaxCalculation'->>'ok')::boolean, false)
    AND _snapshot->'globalTaxCalculation'->>'status' IN ('calculated','manual_unverified');

  IF upper(coalesce(_business.country_code,'IN')) <> 'IN' AND NOT _global_tax AND NOT _draft THEN
    RAISE EXCEPTION 'global invoice tax calculation is required' USING ERRCODE = '22023';
  END IF;

  IF upper(coalesce(_business.country_code,'IN')) <> 'IN' AND NOT _global_tax AND _draft THEN
    -- Assistant-created global invoices remain drafts until tax details are completed.
    _rate := 0;
    _tax := 0;
    _mode := 'split';
    _taxable := GREATEST(0, _subtotal - _dv);
  END IF;

  IF _global_tax THEN
    -- Registration metadata is reconstructed from the authenticated workspace row.
    _snapshot := jsonb_set(_snapshot, '{globalTaxProfileSnapshot}', jsonb_build_object(
      'countryCode', upper(coalesce(_business.country_code,'')),
      'registrationNumber', _business.tax_registration_number,
      'registrationType', _business.tax_registration_type,
      'registrationStatus', _business.tax_registration_status,
      'registrationEffectiveFrom', _business.tax_registration_effective_from,
      'registeredJurisdiction', _business.tax_jurisdiction_code
    ), true);
    _snapshot := jsonb_set(_snapshot, '{business}',
      coalesce(_snapshot->'business','{}'::jsonb) || jsonb_build_object(
        'taxRegistrationNumber', _business.tax_registration_number,
        'taxRegistrationType', _business.tax_registration_type,
        'taxRegistrationStatus', _business.tax_registration_status,
        'taxRegistrationEffectiveFrom', _business.tax_registration_effective_from,
        'registeredJurisdiction', _business.tax_jurisdiction_code
      ), true);
    IF upper(coalesce(_business.country_code,'')) <> _global_country THEN
      RAISE EXCEPTION 'invoice country does not match workspace country' USING ERRCODE = '22023';
    END IF;
    _expected_currency := CASE _global_country
      WHEN 'US' THEN 'USD' WHEN 'GB' THEN 'GBP' WHEN 'AE' THEN 'AED'
      WHEN 'CA' THEN 'CAD' WHEN 'AU' THEN 'AUD' WHEN 'SG' THEN 'SGD' END;
    IF upper(coalesce(_data->>'currency','')) <> _expected_currency
      OR upper(coalesce(_snapshot->'globalTaxCalculation'->>'currencyCode','')) <> _expected_currency THEN
      RAISE EXCEPTION 'global invoice currency mismatch' USING ERRCODE = '22023';
    END IF;
    IF _business.tax_registration_status <> 'registered'
      OR nullif(trim(_business.tax_registration_number),'') IS NULL
      OR nullif(trim(_business.tax_registration_type),'') IS NULL
      OR _business.tax_registration_effective_from IS NULL
      OR _issue_date < _business.tax_registration_effective_from
      OR coalesce((_snapshot->'globalTax'->>'registrationConfirmed')::boolean,false) IS NOT TRUE
      OR coalesce((_snapshot->'globalTax'->>'placeOfSupplyConfirmed')::boolean,false) IS NOT TRUE
      OR nullif(trim(_snapshot->'globalTax'->>'placeOfSupply'),'') IS NULL
      OR coalesce((_snapshot->'globalTax'->>'taxCategoryConfirmed')::boolean,false) IS NOT TRUE
      OR nullif(trim(_snapshot->'globalTax'->>'taxCategory'),'') IS NULL
      OR nullif(trim(_snapshot->'business'->>'name'),'') IS NULL
      OR nullif(trim(_snapshot->'business'->>'address'),'') IS NULL THEN
      RAISE EXCEPTION 'global invoice tax profile or transaction facts are incomplete' USING ERRCODE = '22023';
    END IF;

    _global_mode := _snapshot->'globalTax'->>'mode';
    IF (_global_mode = 'automatic'
        AND _snapshot->'globalTaxCalculation'->>'status' IS DISTINCT FROM 'calculated')
      OR (_global_mode = 'manual'
        AND _snapshot->'globalTaxCalculation'->>'status' IS DISTINCT FROM 'manual_unverified') THEN
      RAISE EXCEPTION 'global tax calculation mode and status do not match' USING ERRCODE = '22023';
    END IF;
    _global_price_mode := _snapshot->'globalTax'->>'priceMode';
    IF _global_price_mode NOT IN ('exclusive','inclusive') THEN
      RAISE EXCEPTION 'invalid global tax price mode' USING ERRCODE = '22023';
    END IF;
    _manual_tax_treatment := lower(btrim(coalesce(_snapshot->'globalTax'->>'taxCategory','')));
    IF _manual_tax_treatment <> 'standard-rated' THEN
      RAISE EXCEPTION 'unsupported global tax treatment; only standard-rated is supported' USING ERRCODE = '22023';
    END IF;

    IF _global_mode = 'automatic' THEN
      _expected_rate_bps := CASE _global_country WHEN 'GB' THEN 2000 WHEN 'AE' THEN 500 WHEN 'AU' THEN 1000 WHEN 'SG' THEN 900 ELSE NULL END;
      _expected_rule_id := CASE _global_country
        WHEN 'GB' THEN 'GB-VAT-STANDARD-2026-11'
        WHEN 'AE' THEN 'AE-VAT-STANDARD-2026-11'
        WHEN 'AU' THEN 'AU-GST-STANDARD-2026-11'
        WHEN 'SG' THEN 'SG-GST-STANDARD-2026-11' ELSE NULL END;
      _legal_effective_from := CASE _global_country
        WHEN 'GB' THEN DATE '2011-01-04'
        WHEN 'AE' THEN DATE '2018-01-01'
        WHEN 'AU' THEN DATE '2000-07-01'
        WHEN 'SG' THEN DATE '2024-01-01'
        ELSE NULL END;
      IF _expected_rate_bps IS NULL
        OR _snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'id' IS DISTINCT FROM _expected_rule_id
        OR _snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'effectiveFrom' IS DISTINCT FROM _legal_effective_from::text
        OR nullif(_snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'version','') IS NULL
        OR nullif(_snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'reviewedOn','') IS NULL
        OR (_snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'reviewedOn')::date < _legal_effective_from
        OR (_snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'reviewedOn')::date > CURRENT_DATE
        OR nullif(_snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'effectiveTo','') IS NOT NULL
        OR _issue_date < _legal_effective_from THEN
        RAISE EXCEPTION 'no verified automatic tax rule is available for this country and legal effective period' USING ERRCODE = '22023';
      END IF;
      IF (_global_country = 'GB' AND _snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'source' IS DISTINCT FROM 'https://www.gov.uk/vat-rates')
        OR (_global_country = 'AE' AND _snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'source' IS DISTINCT FROM 'https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/')
        OR (_global_country = 'AU' AND _snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'source' IS DISTINCT FROM 'https://www.ato.gov.au/Business/GST/')
        OR (_global_country = 'SG' AND _snapshot->'globalTaxCalculation'->'ruleSnapshot'->>'source' IS DISTINCT FROM 'https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/current-gst-rates') THEN
        RAISE EXCEPTION 'automatic tax rule source is not allowlisted' USING ERRCODE = '22023';
      END IF;
    ELSIF _global_mode = 'manual' THEN
      IF _global_country IN ('US','CA') THEN
        _destination_region := upper(coalesce(
          _snapshot->'globalTax'->'destinationJurisdiction'->>(CASE WHEN _global_country='US' THEN 'state' ELSE 'province' END), ''
        ));
        _registered_region := upper(coalesce(_business.tax_jurisdiction_code,''));
        _seller_region := split_part(_registered_region,'-',2);
        IF _destination_region = ''
          OR array_length(string_to_array(_registered_region,'-'),1) <> 2
          OR split_part(_registered_region,'-',1) <> _global_country
          OR (_global_country='US' AND (
            _destination_region NOT IN ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC')
            OR _seller_region NOT IN ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC')
          ))
          OR (_global_country='CA' AND (
            _destination_region NOT IN ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')
            OR _seller_region NOT IN ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')
          ))
          OR coalesce((_snapshot->'globalTax'->>'collectionObligationAttested')::boolean,false) IS NOT TRUE THEN
          RAISE EXCEPTION 'US/Canada destination or seller registration jurisdiction is invalid, or collection-obligation attestation is missing' USING ERRCODE = '22023';
        END IF;
        IF _global_country='US' AND (
          nullif(trim(_snapshot->'globalTax'->'destinationJurisdiction'->>'county'),'') IS NULL
          OR nullif(trim(_snapshot->'globalTax'->'destinationJurisdiction'->>'city'),'') IS NULL
        ) THEN
          RAISE EXCEPTION 'US county and city are required' USING ERRCODE = '22023';
        END IF;
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported global tax calculation mode' USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(_snapshot->'globalTaxCalculation'->'components') <> 'array'
      OR jsonb_array_length(_snapshot->'globalTaxCalculation'->'components') < 1
      OR jsonb_array_length(_snapshot->'globalTaxCalculation'->'components') > 8 THEN
      RAISE EXCEPTION 'global tax components are required' USING ERRCODE = '22023';
    END IF;
    FOR _component IN SELECT value FROM jsonb_array_elements(_snapshot->'globalTaxCalculation'->'components') LOOP
      IF nullif(trim(_component->>'id'),'') IS NULL
        OR nullif(trim(_component->>'name'),'') IS NULL
        OR coalesce((_component->>'rateBps')::integer,0) <= 0
        OR coalesce((_component->>'rateBps')::integer,0) > 10000
        OR coalesce((_component->>'amountMinor')::numeric,-1) < 0 THEN
        RAISE EXCEPTION 'invalid global tax component' USING ERRCODE = '22023';
      END IF;
      _component_count := _component_count + 1;
      _global_rate := _global_rate + (_component->>'rateBps')::numeric / 10000;
      _components_total_minor := _components_total_minor + (_component->>'amountMinor')::numeric;
    END LOOP;
    IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(_snapshot->'globalTaxCalculation'->'components')) <> _component_count THEN
      RAISE EXCEPTION 'duplicate global tax component IDs' USING ERRCODE = '22023';
    END IF;
    IF _global_rate <= 0 OR _global_rate > 1 THEN
      RAISE EXCEPTION 'global tax rate is outside supported range' USING ERRCODE = '22023';
    END IF;
    IF _global_mode = 'automatic' AND (_component_count <> 1 OR
      (SELECT coalesce(sum((value->>'rateBps')::integer),0) FROM jsonb_array_elements(_snapshot->'globalTaxCalculation'->'components')) <> _expected_rate_bps) THEN
      RAISE EXCEPTION 'automatic rule component does not match the allowlisted rate' USING ERRCODE = '22023';
    END IF;

    _global_gross := round(GREATEST(0, _subtotal - _dv), 2);
    IF _global_price_mode = 'inclusive' THEN
      _taxable := round(_global_gross / (1 + _global_rate), 2);
      _tax := _global_gross - _taxable;
      _global_total := _global_gross;
    ELSE
      _taxable := _global_gross;
      _tax := round(_taxable * _global_rate, 2);
      _global_total := _taxable + _tax;
    END IF;
    _expected_taxable_minor := round(_taxable * 100);
    _expected_tax_minor := round(_tax * 100);
    IF abs(coalesce((_snapshot->'globalTaxCalculation'->>'taxableMinor')::numeric,-1) - _expected_taxable_minor) > 0
      OR abs(coalesce((_snapshot->'globalTaxCalculation'->>'taxMinor')::numeric,-1) - _expected_tax_minor) > 0
      OR abs(coalesce((_snapshot->'globalTaxCalculation'->>'totalMinor')::numeric,-1) - round(_global_total * 100)) > 0
      OR abs(_components_total_minor - _expected_tax_minor) > 0 THEN
      RAISE EXCEPTION 'global tax calculation snapshot does not reconcile with server totals' USING ERRCODE = '22023';
    END IF;
    -- Verify each displayed component amount as well as the aggregate tax.
    _components_total_minor := 0;
    _component_index := 0;
    FOR _component IN SELECT value FROM jsonb_array_elements(_snapshot->'globalTaxCalculation'->'components') LOOP
      _component_index := _component_index + 1;
      IF _component_index = _component_count THEN
        _expected_component_minor := _expected_tax_minor - _components_total_minor;
      ELSE
        _expected_component_minor := floor((_expected_taxable_minor * (_component->>'rateBps')::numeric + 5000) / 10000);
      END IF;
      IF (_component->>'amountMinor')::numeric <> _expected_component_minor THEN
        RAISE EXCEPTION 'global tax component amount does not reconcile' USING ERRCODE = '22023';
      END IF;
      _components_total_minor := _components_total_minor + _expected_component_minor;
    END LOOP;
  END IF;

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
    currency = COALESCE(_data->>'currency','INR'), tax_mode = _mode, tax_rate = CASE WHEN _global_tax THEN 0 ELSE _rate END,
    discount_type = _dtype, discount = _disc, notes = _data->>'notes', terms = _data->>'terms',
    status = _status, is_draft = _draft,
    subtotal = _subtotal, tax_value = _tax,
    cgst = CASE WHEN _global_tax THEN 0 WHEN _mode = 'split' THEN _tax / 2 ELSE 0 END,
    sgst = CASE WHEN _global_tax THEN 0 WHEN _mode = 'split' THEN _tax / 2 ELSE 0 END,
    igst = CASE WHEN _global_tax THEN 0 WHEN _mode = 'igst' THEN _tax ELSE 0 END,
    total = GREATEST(0, CASE WHEN _global_tax THEN _global_total ELSE _taxable + _tax END),
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

REVOKE ALL ON FUNCTION public.save_invoice(jsonb,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_invoice(jsonb,jsonb,uuid) TO authenticated;
