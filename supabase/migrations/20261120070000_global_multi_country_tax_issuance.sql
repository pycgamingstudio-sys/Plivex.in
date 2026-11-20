-- Country-aware, server-recalculated Global tax invoice issuance.
-- US remains fail-closed until an address-level, maintained state/local rule source is integrated.
begin;

alter table global.invoice_items
  alter column tax_rate_bps type numeric(7,1)
  using tax_rate_bps::numeric;

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
  v_tax_snapshot jsonb;
  v_existing global.invoices%rowtype;
  v_item global.invoice_items%rowtype;
  v_line_base bigint;
  v_line_tax bigint;
  v_line_discount bigint;
  v_remaining_discount bigint;
  v_items_subtotal bigint;
  v_line_index integer := 0;
  v_line_count integer := 0;
  v_subtotal_after_discount bigint;
  v_tax bigint := 0;
  v_total bigint;
  v_taxable bigint;
  v_number bigint;
  v_invoice_number text;
  v_price_mode text;
  v_place text;
  v_country text;
  v_currency text;
  v_province text;
  v_tax_category text;
  v_tax_system text;
  v_registration_type text;
  v_rule_id text;
  v_rule_version text;
  v_rule_source text;
  v_rule_authority text;
  v_effective_from date;
  v_reviewed_on date;
  v_rate numeric(7,1);
  v_components jsonb := '[]'::jsonb;
  v_components_snapshot jsonb := '[]'::jsonb;
  v_component jsonb;
  v_component_rate numeric(7,1);
  v_component_amount bigint;
  v_component_total bigint := 0;
  v_issuance_fingerprint text;
  v_items jsonb;
  v_component_count integer := 0;
  v_last_index integer;
  v_last_amount bigint;
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

  v_country := upper(coalesce(v_workspace.country_code,''));
  v_currency := upper(coalesce(v_workspace.currency_code,''));
  v_province := upper(coalesce(p_tax_context->'destination_jurisdiction'->>'province',''));
  v_tax_category := upper(coalesce(p_tax_context->>'tax_category',''));
  if v_country = 'US' then
    return jsonb_build_object('ok',false,'reason','jurisdiction_rule_required');
  end if;
  if v_country not in ('GB','AE','CA','AU','SG') then
    return jsonb_build_object('ok',false,'reason','country_not_enabled');
  end if;
  if (v_country,v_currency) not in (('GB','GBP'),('AE','AED'),('CA','CAD'),('AU','AUD'),('SG','SGD'))
    or v_profile.country_code is distinct from v_country
    or v_profile.currency_code is distinct from v_currency
    or v_invoice.currency_code is distinct from v_currency then
    return jsonb_build_object('ok',false,'reason','invalid_currency');
  end if;

  if v_profile.tax_registration_status <> 'registered'
    or nullif(btrim(v_profile.tax_registration_number),'') is null
    or v_profile.tax_registration_effective_from is null
    or v_invoice.issue_date < v_profile.tax_registration_effective_from
    or nullif(btrim(v_profile.legal_name),'') is null
    or nullif(btrim(v_profile.address),'') is null then
    return jsonb_build_object('ok',false,'reason','seller_profile_incomplete');
  end if;

  v_registration_type := upper(replace(coalesce(v_profile.tax_registration_type,''),' ',''));
  if (v_country in ('GB','AE') and v_registration_type <> 'VAT')
    or (v_country = 'CA' and v_registration_type not in ('GST','GST/HST','HST','PST','QST','GST/HST/PST/QST'))
    or (v_country = 'AU' and v_registration_type not in ('ABN','GST'))
    or (v_country = 'SG' and v_registration_type <> 'GST') then
    return jsonb_build_object('ok',false,'reason','seller_registration_type_invalid');
  end if;

  if coalesce((p_tax_context->>'registration_confirmed')::boolean,false) is not true
    or coalesce((p_tax_context->>'place_of_supply_confirmed')::boolean,false) is not true
    or coalesce((p_tax_context->>'tax_category_confirmed')::boolean,false) is not true
    or coalesce(p_tax_context->>'mode','') <> 'automatic'
    or coalesce(p_tax_context->>'tax_treatment','standard') <> 'standard'
    or coalesce(p_tax_context->>'price_mode','') not in ('exclusive','inclusive')
    or nullif(btrim(p_tax_context->>'place_of_supply'),'') is null then
    return jsonb_build_object('ok',false,'reason','tax_evidence_incomplete');
  end if;
  if v_country in ('GB','AE','AU','SG') and v_tax_category <> 'STANDARD-RATED' then
    return jsonb_build_object('ok',false,'reason','verified_treatment_rule_required');
  end if;
  if v_country = 'GB' and lower(btrim(p_tax_context->>'place_of_supply')) <> 'united kingdom' then
    return jsonb_build_object('ok',false,'reason','place_of_supply_invalid');
  elsif v_country = 'AE' and lower(btrim(p_tax_context->>'place_of_supply')) not in ('united arab emirates','uae') then
    return jsonb_build_object('ok',false,'reason','place_of_supply_invalid');
  elsif v_country = 'AU' and lower(btrim(p_tax_context->>'place_of_supply')) <> 'australia' then
    return jsonb_build_object('ok',false,'reason','place_of_supply_invalid');
  elsif v_country = 'SG' and lower(btrim(p_tax_context->>'place_of_supply')) <> 'singapore' then
    return jsonb_build_object('ok',false,'reason','place_of_supply_invalid');
  end if;

  if v_country = 'CA' then
    if v_province not in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')
      or coalesce((p_tax_context->>'collection_obligation_attested')::boolean,false) is not true
      or upper(coalesce(v_profile.tax_jurisdiction_code,'')) !~ '^CA-(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$' then
      return jsonb_build_object('ok',false,'reason','jurisdiction_or_collection_obligation_required');
    end if;
  end if;

  v_price_mode := p_tax_context->>'price_mode';
  v_place := left(btrim(p_tax_context->>'place_of_supply'),180);
  select coalesce(sum(line_total_minor),0),count(*)::integer
    into v_items_subtotal,v_line_count
    from global.invoice_items
    where workspace_id=p_workspace_id and invoice_id=p_invoice_id;
  if v_invoice.currency_code <> v_currency
    or v_invoice.subtotal_minor < 0 or v_invoice.discount_minor < 0
    or v_invoice.discount_minor > v_invoice.subtotal_minor
    or v_items_subtotal <> v_invoice.subtotal_minor
    or v_line_count < 1 then
    return jsonb_build_object('ok',false,'reason','invalid_invoice_amounts');
  end if;
  v_subtotal_after_discount := v_items_subtotal-v_invoice.discount_minor;
  v_remaining_discount := v_invoice.discount_minor;

  -- Current standard-rate rule catalog. Every component is recalculated here,
  -- never trusted from a browser-supplied tax total.
  if v_country = 'GB' then
    v_tax_system := 'VAT'; v_rate := 2000; v_rule_id := 'GB-VAT-STANDARD-2026-11';
    v_rule_version := '2026.11'; v_rule_source := 'https://www.gov.uk/vat-rates';
    v_rule_authority := 'UK HM Revenue & Customs'; v_effective_from := '2011-01-04'; v_reviewed_on := '2026-11-14';
    v_components := jsonb_build_array(jsonb_build_object('id','GB-VAT-STANDARD','name','VAT','rateBps',2000,'source',v_rule_source));
  elsif v_country = 'AE' then
    v_tax_system := 'VAT'; v_rate := 500; v_rule_id := 'AE-VAT-STANDARD-2026-11';
    v_rule_version := '2026.11'; v_rule_source := 'https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/';
    v_rule_authority := 'UAE Ministry of Finance'; v_effective_from := '2018-01-01'; v_reviewed_on := '2026-11-14';
    v_components := jsonb_build_array(jsonb_build_object('id','AE-VAT-STANDARD','name','VAT','rateBps',500,'source',v_rule_source));
  elsif v_country = 'AU' then
    v_tax_system := 'GST'; v_rate := 1000; v_rule_id := 'AU-GST-STANDARD-2026-11';
    v_rule_version := '2026.11'; v_rule_source := 'https://www.ato.gov.au/Business/GST/';
    v_rule_authority := 'Australian Taxation Office'; v_effective_from := '2000-07-01'; v_reviewed_on := '2026-11-14';
    v_components := jsonb_build_array(jsonb_build_object('id','AU-GST-STANDARD','name','GST','rateBps',1000,'source',v_rule_source));
  elsif v_country = 'SG' then
    v_tax_system := 'GST'; v_rate := 900; v_rule_id := 'SG-GST-STANDARD-2026-11';
    v_rule_version := '2026.11'; v_rule_source := 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/current-gst-rates';
    v_rule_authority := 'Singapore Inland Revenue Authority'; v_effective_from := '2024-01-01'; v_reviewed_on := '2026-11-14';
    v_components := jsonb_build_array(jsonb_build_object('id','SG-GST-STANDARD','name','GST','rateBps',900,'source',v_rule_source));
  elsif v_country = 'CA' then
    v_tax_system := 'GST/HST/PST/QST'; v_rule_version := '2025.04';
    v_rule_source := 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html';
    v_rule_authority := 'Canada Revenue Agency'; v_effective_from := '2025-04-01'; v_reviewed_on := '2026-11-20';
    if v_province in ('BC','MB','SK') then
      if v_tax_category <> 'CA_' || v_province || '_PST_TAXABLE_GOODS' then
        return jsonb_build_object('ok',false,'reason','canadian_pst_taxability_required');
      end if;
    elsif v_tax_category <> 'STANDARD-RATED' then
      return jsonb_build_object('ok',false,'reason','verified_treatment_rule_required');
    end if;
    if v_province = 'AB' then
      v_rate := 500; v_rule_id := 'CA-AB-GST-HST-PST-2025-04';
      v_components := jsonb_build_array(jsonb_build_object('id','CA-AB-GST','name','GST','rateBps',500,'source',v_rule_source));
    elsif v_province = 'BC' then
      v_rate := 1200; v_rule_id := 'CA-BC-GST-HST-PST-2025-04';
      v_components := jsonb_build_array(jsonb_build_object('id','CA-BC-GST','name','GST','rateBps',500,'source',v_rule_source),jsonb_build_object('id','CA-BC-PST','name','PST','rateBps',700,'source',v_rule_source));
    elsif v_province = 'MB' then
      v_rate := 1200; v_rule_id := 'CA-MB-GST-HST-PST-2025-04';
      v_components := jsonb_build_array(jsonb_build_object('id','CA-MB-GST','name','GST','rateBps',500,'source',v_rule_source),jsonb_build_object('id','CA-MB-RST','name','RST','rateBps',700,'source',v_rule_source));
    elsif v_province in ('NB','NL','PE') then
      v_rate := 1500; v_rule_id := 'CA-' || v_province || '-GST-HST-PST-2025-04';
      v_components := jsonb_build_array(jsonb_build_object('id','CA-' || v_province || '-HST','name','HST','rateBps',1500,'source',v_rule_source));
    elsif v_province = 'NS' then
      v_rate := 1400; v_rule_id := 'CA-NS-GST-HST-PST-2025-04';
      v_components := jsonb_build_array(jsonb_build_object('id','CA-NS-HST','name','HST','rateBps',1400,'source',v_rule_source));
    elsif v_province in ('NT','NU','YT') then
      v_rate := 500; v_rule_id := 'CA-' || v_province || '-GST-HST-PST-2025-04';
      v_components := jsonb_build_array(jsonb_build_object('id','CA-' || v_province || '-GST','name','GST','rateBps',500,'source',v_rule_source));
    elsif v_province = 'ON' then
      v_rate := 1300; v_rule_id := 'CA-ON-GST-HST-PST-2025-04';
      v_components := jsonb_build_array(jsonb_build_object('id','CA-ON-HST','name','HST','rateBps',1300,'source',v_rule_source));
    elsif v_province = 'QC' then
      v_rate := 1497.5; v_rule_id := 'CA-QC-GST-HST-PST-2025-04';
      v_components := jsonb_build_array(jsonb_build_object('id','CA-QC-GST','name','GST','rateBps',500,'source',v_rule_source),jsonb_build_object('id','CA-QC-QST','name','QST','rateBps',997.5,'source',v_rule_source));
    elsif v_province = 'SK' then
      v_rate := 1100; v_rule_id := 'CA-SK-GST-HST-PST-2025-04';
      v_components := jsonb_build_array(jsonb_build_object('id','CA-SK-GST','name','GST','rateBps',500,'source',v_rule_source),jsonb_build_object('id','CA-SK-PST','name','PST','rateBps',600,'source',v_rule_source));
    end if;
  end if;

  if v_rate is null or v_rate <= 0 or v_rate > 10000
    or v_invoice.issue_date < v_effective_from or v_invoice.issue_date < v_reviewed_on then
    return jsonb_build_object('ok',false,'reason','no_effective_verified_rule');
  end if;

  for v_item in
    select * from global.invoice_items
    where workspace_id=p_workspace_id and invoice_id=p_invoice_id
    order by sort_order, id
    for update
  loop
    v_line_index := v_line_index+1;
    v_line_base := v_item.line_total_minor;
    -- Allocate the invoice-level discount proportionally in minor units.
    -- The final line absorbs the integer remainder so allocations equal the
    -- exact stored discount and no fractional minor unit is invented.
    if v_line_index = v_line_count then
      v_line_discount := v_remaining_discount;
    elsif v_items_subtotal = 0 then
      v_line_discount := 0;
    else
      v_line_discount := floor(v_invoice.discount_minor::numeric * v_line_base / v_items_subtotal)::bigint;
    end if;
    if v_line_discount < 0 or v_line_discount > v_line_base
      or v_line_discount > v_remaining_discount then
      return jsonb_build_object('ok',false,'reason','discount_allocation_invalid');
    end if;
    v_remaining_discount := v_remaining_discount-v_line_discount;
    v_line_base := v_line_base-v_line_discount;
    if v_price_mode = 'inclusive' then
      v_line_tax := round(v_line_base::numeric * v_rate / (10000+v_rate))::bigint;
    else
      v_line_tax := round(v_line_base::numeric * v_rate / 10000)::bigint;
    end if;
    v_tax := v_tax+v_line_tax;
    update global.invoice_items set tax_rate_bps=v_rate,tax_minor=v_line_tax,
      line_total_minor=case when v_price_mode='exclusive' then v_line_base+v_line_tax else v_line_base end
    where id=v_item.id and workspace_id=p_workspace_id;
  end loop;
  if v_remaining_discount <> 0 then
    return jsonb_build_object('ok',false,'reason','discount_allocation_incomplete');
  end if;

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

  for v_component in select value from jsonb_array_elements(v_components) loop
    v_component_rate := (v_component->>'rateBps')::numeric;
    v_component_amount := round(v_taxable::numeric * v_component_rate / 10000)::bigint;
    v_component_total := v_component_total+v_component_amount;
    v_components_snapshot := v_components_snapshot || jsonb_build_array(jsonb_build_object(
      'id',v_component->>'id','name',v_component->>'name',
      'rate_bps',v_component_rate,'amount_minor',v_component_amount,'source',v_component->>'source'
    ));
  end loop;
  v_component_count := jsonb_array_length(v_components_snapshot);
  v_last_index := v_component_count-1;
  v_last_amount := (v_components_snapshot->v_last_index->>'amount_minor')::bigint + v_tax-v_component_total;
  v_components_snapshot := jsonb_set(v_components_snapshot,ARRAY[v_last_index::text,'amount_minor'],to_jsonb(v_last_amount),true);

  insert into global.invoice_number_sequences(workspace_id,invoice_year,last_number)
  values(p_workspace_id,extract(year from v_invoice.issue_date)::integer,1)
  on conflict(workspace_id,invoice_year) do update
    set last_number=global.invoice_number_sequences.last_number+1,updated_at=now()
  returning last_number into v_number;
  v_invoice_number := 'INV-' || v_country || '-' || extract(year from v_invoice.issue_date)::integer::text || '-' || lpad(v_number::text,6,'0');

  v_tax_snapshot := jsonb_build_object(
    'document_status','issued',
    'issuance_request_fingerprint',v_issuance_fingerprint,
    'country_code',v_country,
    'currency_code',v_currency,
    'tax_system',v_tax_system,
    'tax_status','calculated',
    'tax_mode','automatic',
    'price_mode',v_price_mode,
    'tax_category',p_tax_context->>'tax_category',
    'place_of_supply',v_place,
    'jurisdiction_id',case when v_country='CA' then v_province else null end,
    'collection_obligation_attested',case when v_country='CA' then true else null end,
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
      'components',v_components_snapshot,
      'rule',jsonb_build_object(
        'id',v_rule_id,'version',v_rule_version,'source',v_rule_source,
        'source_authority',v_rule_authority,'effective_from',v_effective_from,'reviewed_on',v_reviewed_on
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

  select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order),'[]'::jsonb)
    into v_items from global.invoice_items t
    where t.workspace_id=p_workspace_id and t.invoice_id=p_invoice_id;

  return jsonb_build_object('ok',true,'duplicate',false,'invoice',to_jsonb(v_invoice),'items',v_items);
end;
$function$;

revoke all on function public.global_issue_invoice(uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.global_issue_invoice(uuid,uuid,uuid,jsonb,uuid) to service_role;

commit;
