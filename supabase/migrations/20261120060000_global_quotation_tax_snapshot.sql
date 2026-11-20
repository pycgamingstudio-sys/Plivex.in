-- Persist source-backed quotation tax estimates and block sending unresolved-tax quotations.
begin;

alter table global.quotations
  add column if not exists taxable_minor bigint,
  add column if not exists tax_minor bigint not null default 0,
  add column if not exists tax_status text not null default 'review_required',
  add column if not exists tax_snapshot jsonb;

alter table global.quotations
  drop constraint if exists global_quotations_tax_status_check;
alter table global.quotations
  add constraint global_quotations_tax_status_check
  check (tax_status in ('calculated','review_required','not_applicable'));

create or replace function public.global_manage_quotation_with_tax(
  p_user_id uuid,
  p_workspace_id uuid,
  p_action text,
  p_quotation_id uuid default null,
  p_client_id uuid default null,
  p_currency_code text default null,
  p_issue_date date default null,
  p_valid_until date default null,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb,
  p_status text default null,
  p_idempotency_key uuid default null,
  p_tax_snapshot jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global, public
as $function$
declare
  v_result jsonb;
  v_quote global.quotations%rowtype;
  v_invoice_id uuid;
  v_item jsonb;
  v_component jsonb;
  v_tax_result jsonb;
  v_tax_context jsonb;
  v_rule jsonb;
  v_country text;
  v_province text;
  v_expected_rate numeric;
  v_expected_rule text;
  v_expected_source text;
  v_pre_tax bigint := 0;
  v_line bigint;
  v_discount bigint;
  v_taxable bigint;
  v_tax bigint;
  v_total bigint;
  v_component_tax bigint := 0;
  v_component_rate numeric := 0;
  v_component_count integer := 0;
  v_expected_component_minor bigint;
  v_tax_status text := 'calculated';
  v_expected_component_name text;
  v_expected_component_rate numeric;
  v_treatment text;
  v_tax_rule global.tax_rule_versions%rowtype;
  v_rule_count integer := 0;
  v_rule_jurisdiction text;
begin
  if p_user_id is null or p_workspace_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_identity');
  end if;
  if not exists (
    select 1 from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  ) then
    return jsonb_build_object('ok',false,'reason','access_denied');
  end if;

  if p_action = 'create' then
    if p_tax_snapshot is not null then
      if jsonb_typeof(p_tax_snapshot) <> 'object'
        or octet_length(p_tax_snapshot::text) > 65536
        or jsonb_typeof(p_tax_snapshot->'taxResult') is distinct from 'object'
        or jsonb_typeof(p_tax_snapshot->'taxContext') is distinct from 'object' then
        return jsonb_build_object('ok',false,'reason','invalid_tax_snapshot');
      end if;
      v_tax_result := p_tax_snapshot->'taxResult';
      v_tax_context := p_tax_snapshot->'taxContext';
      v_rule := v_tax_result->'ruleSnapshot';
      v_country := upper(coalesce(v_tax_result->>'countryCode',''));
      v_treatment := lower(coalesce(v_tax_result->>'treatment',''));
      if v_tax_result->>'status' is distinct from 'not_applicable' then
      if v_tax_result->>'ok' is distinct from 'true'
        or v_tax_result->>'status' is distinct from 'calculated'
        or v_tax_result->>'mode' is distinct from 'automatic'
        or v_tax_result->>'priceMode' is distinct from 'exclusive'
        or v_tax_result->>'invoiceDate' is distinct from p_issue_date::text
        or v_tax_result->>'currencyCode' is distinct from upper(coalesce(p_currency_code,''))
        or v_tax_context->>'countryCode' is distinct from v_country
        or v_tax_context->>'mode' is distinct from 'automatic'
        or v_treatment not in ('standard','reduced','zero-rated','gst-free','exempt','out-of-scope')
        or v_tax_context->>'taxTreatment' is distinct from v_treatment
        or v_tax_result->>'taxCategory' is distinct from v_tax_context->>'taxCategory'
        or v_tax_context->>'priceMode' is distinct from 'exclusive'
        or v_tax_context->>'taxDetailsConfirmed' is distinct from 'true'
        or (v_country = 'CA' and v_tax_context->>'collectionObligationAttested' is distinct from 'true')
        or nullif(trim(v_tax_context->>'placeOfSupply'),'') is null
        or nullif(trim(v_tax_context->>'taxCategory'),'') is null
        or v_rule is null
        or v_tax_result->>'treatment' is distinct from v_treatment
        or jsonb_typeof(v_tax_result->'components') is distinct from 'array'
        or jsonb_array_length(v_tax_result->'components') < 1
        or jsonb_array_length(v_tax_result->'components') > 8 then
        return jsonb_build_object('ok',false,'reason','invalid_tax_snapshot');
      end if;

      if v_treatment='standard' then
        v_expected_rate := case v_country
          when 'GB' then 2000 when 'AE' then 500 when 'AU' then 1000 when 'SG' then 900
          when 'CA' then case upper(coalesce(v_tax_context->'destinationJurisdiction'->>'province',''))
            when 'AB' then 500 when 'BC' then 1200 when 'MB' then 1200
            when 'NB' then 1500 when 'NL' then 1500 when 'NS' then 1400
            when 'NT' then 500 when 'NU' then 500 when 'ON' then 1300
            when 'PE' then 1500 when 'QC' then 1497.5 when 'SK' then 1100
            when 'YT' then 500 else null end
          else null end;
        v_expected_rule := case v_country
          when 'GB' then 'GB-VAT-STANDARD-2026-11'
          when 'AE' then 'AE-VAT-STANDARD-2026-11'
          when 'AU' then 'AU-GST-STANDARD-2026-11'
          when 'SG' then 'SG-GST-STANDARD-2026-11'
          when 'CA' then 'CA-' || upper(coalesce(v_tax_context->'destinationJurisdiction'->>'province','')) || '-GST-HST-PST-2025-04'
          else null end;
        v_expected_source := case v_country
          when 'GB' then 'https://www.gov.uk/vat-rates'
          when 'AE' then 'https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/'
          when 'AU' then 'https://www.ato.gov.au/Business/GST/'
          when 'SG' then 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/current-gst-rates'
          when 'CA' then 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html'
          else null end;
        if v_expected_rate is null
          or v_rule->>'id' is distinct from v_expected_rule
          or v_rule->>'source' is distinct from v_expected_source then
          return jsonb_build_object('ok',false,'reason','unverified_tax_rule');
        end if;
  
        if v_country = 'GB' and v_tax_context->>'placeOfSupply' is distinct from 'United Kingdom'
          or v_country = 'AE' and v_tax_context->>'placeOfSupply' is distinct from 'United Arab Emirates'
          or v_country = 'AU' and v_tax_context->>'placeOfSupply' is distinct from 'Australia'
          or v_country = 'SG' and v_tax_context->>'placeOfSupply' is distinct from 'Singapore' then
          return jsonb_build_object('ok',false,'reason','invalid_tax_snapshot');
        end if;
        if v_country = 'CA' then
          v_province := upper(v_tax_context->'destinationJurisdiction'->>'province');
          if v_tax_result->>'jurisdictionId' is distinct from v_province then
            return jsonb_build_object('ok',false,'reason','unverified_tax_rule');
          end if;
          if v_province in ('BC','MB','SK','QC') then
            v_expected_component_name := case v_province when 'BC' then 'PST' when 'MB' then 'RST' when 'SK' then 'PST' else 'QST' end;
            v_expected_component_rate := case v_province when 'BC' then 700 when 'MB' then 700 when 'SK' then 600 else 997.5 end;
            if v_tax_context->>'taxCategory' is distinct from ('CA_' || v_province || '_PST_TAXABLE_GOODS')
              or jsonb_array_length(v_tax_result->'components') <> 2
              or v_tax_result->'components'->0->>'name' is distinct from 'GST'
              or (v_tax_result->'components'->0->>'rateBps')::numeric <> 500
              or v_tax_result->'components'->1->>'name' is distinct from v_expected_component_name
              or (v_tax_result->'components'->1->>'rateBps')::numeric <> v_expected_component_rate then
              return jsonb_build_object('ok',false,'reason','unverified_tax_components');
            end if;
          else
            if v_tax_context->>'taxCategory' is distinct from 'standard-rated' then
              return jsonb_build_object('ok',false,'reason','unverified_tax_components');
            end if;
            v_expected_component_name := case when v_province in ('NB','NL','NS','ON','PE') then 'HST' else 'GST' end;
            if jsonb_array_length(v_tax_result->'components') <> 1
              or v_tax_result->'components'->0->>'name' is distinct from v_expected_component_name
              or (v_tax_result->'components'->0->>'rateBps')::numeric <> v_expected_rate then
              return jsonb_build_object('ok',false,'reason','unverified_tax_components');
            end if;
          end if;
        else
          if v_tax_context->>'taxCategory' is distinct from 'standard-rated'
            or jsonb_array_length(v_tax_result->'components') <> 1
            or v_tax_result->'components'->0->>'name' is distinct from (case when v_country in ('GB','AE') then 'VAT' else 'GST' end)
            or (v_tax_result->'components'->0->>'rateBps')::numeric <> v_expected_rate then
            return jsonb_build_object('ok',false,'reason','unverified_tax_components');
          end if;
        end if;
  
        for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
          v_line := round((v_item->>'quantity')::numeric * (v_item->>'unit_price_minor')::numeric)::bigint;
          v_discount := coalesce(nullif(v_item->>'discount_minor','')::bigint,0);
          v_pre_tax := v_pre_tax + v_line - v_discount;
        end loop;
        v_taxable := (v_tax_result->>'taxableMinor')::bigint;
        v_tax := (v_tax_result->>'taxMinor')::bigint;
        v_total := (v_tax_result->>'totalMinor')::bigint;
        if v_taxable <> v_pre_tax or v_tax < 0 or v_tax > 9000000000000000
          or v_total > 9000000000000000 or v_total <> v_taxable + v_tax then
          return jsonb_build_object('ok',false,'reason','tax_total_mismatch');
        end if;
        for v_component in select value from jsonb_array_elements(v_tax_result->'components') loop
          v_expected_component_minor := round(v_taxable * (v_component->>'rateBps')::numeric / 10000)::bigint;
          if v_component->>'source' is distinct from v_expected_source
            or (v_component->>'amountMinor')::bigint <> v_expected_component_minor then
            return jsonb_build_object('ok',false,'reason','tax_component_rate_mismatch');
          end if;
          v_component_tax := v_component_tax + (v_component->>'amountMinor')::bigint;
          v_component_rate := v_component_rate + (v_component->>'rateBps')::numeric;
          v_component_count := v_component_count + 1;
        end loop;
        if v_component_tax <> v_tax or v_component_rate <> v_expected_rate then
          return jsonb_build_object('ok',false,'reason','tax_component_total_mismatch');
        end if;
  
      else
        if v_treatment='reverse-charge' then
          return jsonb_build_object('ok',false,'reason','reverse_charge_quotation_adapter_required');
        end if;
        if v_country not in ('GB','AE','CA','AU','SG') then
          return jsonb_build_object('ok',false,'reason','special_treatment_country_not_supported');
        end if;
        if v_country='GB' and v_tax_context->>'placeOfSupply' is distinct from 'United Kingdom'
          or v_country='AE' and v_tax_context->>'placeOfSupply' is distinct from 'United Arab Emirates'
          or v_country='AU' and v_tax_context->>'placeOfSupply' is distinct from 'Australia'
          or v_country='SG' and v_tax_context->>'placeOfSupply' is distinct from 'Singapore' then
          return jsonb_build_object('ok',false,'reason','invalid_tax_snapshot');
        end if;
        v_province := upper(coalesce(v_tax_context->'destinationJurisdiction'->>'province',''));
        v_rule_jurisdiction := case when v_country='CA' then v_province else null end;
        if v_country='CA' and (v_province not in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')
          or v_tax_result->>'jurisdictionId' is distinct from v_province) then
          return jsonb_build_object('ok',false,'reason','unverified_special_treatment_jurisdiction');
        end if;
        select count(*)::integer into v_rule_count
        from global.tax_rule_versions r
        where r.country_code=v_country and r.currency_code=upper(p_currency_code)
          and coalesce(r.jurisdiction_id,'')=coalesce(v_rule_jurisdiction,'')
          and r.tax_code=v_tax_context->>'taxCategory'
          and r.treatment=v_treatment and r.status='verified'
          and r.effective_from<=p_issue_date
          and (r.effective_to is null or r.effective_to>=p_issue_date)
          and r.reviewed_on<=p_issue_date;
        if v_rule_count<>1 then
          return jsonb_build_object('ok',false,'reason','verified_special_treatment_rule_unavailable');
        end if;
        select * into v_tax_rule
        from global.tax_rule_versions r
        where r.country_code=v_country and r.currency_code=upper(p_currency_code)
          and coalesce(r.jurisdiction_id,'')=coalesce(v_rule_jurisdiction,'')
          and r.tax_code=v_tax_context->>'taxCategory'
          and r.treatment=v_treatment and r.status='verified'
          and r.effective_from<=p_issue_date
          and (r.effective_to is null or r.effective_to>=p_issue_date)
          and r.reviewed_on<=p_issue_date;
        if v_rule->>'treatment' is distinct from v_treatment
          or v_rule->>'version' is distinct from v_tax_rule.version
          or v_rule->>'source' is distinct from v_tax_rule.source_url
          or v_rule->>'taxCategoryId' is distinct from v_tax_rule.tax_code
          or jsonb_typeof(v_tax_rule.components) is distinct from 'array'
          or jsonb_array_length(v_tax_rule.components)<>jsonb_array_length(v_tax_result->'components') then
          return jsonb_build_object('ok',false,'reason','unverified_special_treatment_rule');
        end if;
        select coalesce(sum((c->>'rateBps')::numeric),0) into v_expected_rate
        from jsonb_array_elements(v_tax_rule.components) c;
        if v_expected_rate>10000
          or (v_treatment in ('zero-rated','gst-free','exempt','out-of-scope') and v_expected_rate<>0)
          or (v_treatment='reduced' and v_expected_rate<=0) then
          return jsonb_build_object('ok',false,'reason','special_treatment_rate_mismatch');
        end if;
        v_expected_source := v_tax_rule.source_url;
        for v_component in select value from jsonb_array_elements(v_tax_result->'components') loop
          if not exists (
            select 1 from jsonb_array_elements(v_tax_rule.components) c
            where c->>'id'=v_component->>'id'
              and coalesce(c->>'name',c->>'id')=v_component->>'name'
              and (c->>'rateBps')::numeric=(v_component->>'rateBps')::numeric
          ) or v_component->>'source' is distinct from v_expected_source then
            return jsonb_build_object('ok',false,'reason','unverified_special_treatment_components');
          end if;
        end loop;
      end if;
      v_tax_status := 'calculated';
      else
        if v_tax_result->>'ok' is distinct from 'true'
          or v_tax_result->>'status' is distinct from 'not_applicable'
          or v_tax_result->>'mode' is distinct from 'no_tax'
          or v_tax_result->>'invoiceDate' is distinct from p_issue_date::text
          or v_tax_result->>'currencyCode' is distinct from upper(coalesce(p_currency_code,''))
          or v_tax_result->>'countryCode' is distinct from v_country
          or v_tax_context->>'countryCode' is distinct from v_country
          or v_tax_context->>'taxMode' is distinct from 'no_tax'
          or v_tax_context->>'noTaxConfirmed' is distinct from 'true'
          or jsonb_typeof(v_tax_result->'components') is distinct from 'array'
          or jsonb_array_length(v_tax_result->'components') <> 0 then
          return jsonb_build_object('ok',false,'reason','invalid_no_tax_attestation');
        end if;
        for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
          v_line := round((v_item->>'quantity')::numeric * (v_item->>'unit_price_minor')::numeric)::bigint;
          v_discount := coalesce(nullif(v_item->>'discount_minor','')::bigint,0);
          v_pre_tax := v_pre_tax + v_line - v_discount;
        end loop;
        v_taxable := (v_tax_result->>'taxableMinor')::bigint;
        v_tax := (v_tax_result->>'taxMinor')::bigint;
        v_total := (v_tax_result->>'totalMinor')::bigint;
        if v_taxable <> v_pre_tax or v_tax <> 0 or v_total <> v_pre_tax then
          return jsonb_build_object('ok',false,'reason','invalid_no_tax_attestation');
        end if;
        v_tax_status := 'not_applicable';
      end if;
    end if;
  end if;

  if p_action = 'status' and p_status = 'sent' then
    select * into v_quote from global.quotations
    where id=p_quotation_id and workspace_id=p_workspace_id for update;
    if v_quote.id is null then return jsonb_build_object('ok',false,'reason','quotation_not_found'); end if;
    if v_quote.tax_status not in ('calculated','not_applicable') then
      return jsonb_build_object('ok',false,'reason','quotation_tax_review_required');
    end if;
  end if;

  v_result := public.global_manage_quotation(
    p_user_id,p_workspace_id,p_action,p_quotation_id,p_client_id,p_currency_code,
    p_issue_date,p_valid_until,p_notes,p_items,p_status,p_idempotency_key
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true then return v_result; end if;

  if p_action = 'create' then
    select * into v_quote from global.quotations
    where id = nullif(v_result->'quotation'->>'id','')::uuid and workspace_id=p_workspace_id
    for update;
    if v_quote.id is null then return jsonb_build_object('ok',false,'reason','quotation_not_found'); end if;
    if p_tax_snapshot is null then
      update global.quotations
      set taxable_minor=total_minor,tax_minor=0,tax_status='review_required',tax_snapshot=null,updated_at=now()
      where id=v_quote.id and workspace_id=p_workspace_id
      returning * into v_quote;
    else
      update global.quotations
      set taxable_minor=v_taxable,tax_minor=v_tax,total_minor=v_total,
          tax_status=v_tax_status,tax_snapshot=p_tax_snapshot,updated_at=now()
      where id=v_quote.id and workspace_id=p_workspace_id
      returning * into v_quote;
    end if;
    v_result := jsonb_set(v_result,'{quotation}',to_jsonb(v_quote),true);
  elsif p_action = 'convert' then
    select * into v_quote from global.quotations
    where id=p_quotation_id and workspace_id=p_workspace_id;
    v_invoice_id := nullif(v_result->'invoice'->>'id','')::uuid;
    if v_invoice_id is not null and v_quote.tax_snapshot is not null then
      update global.invoices
      set invoice_snapshot = coalesce(invoice_snapshot,'{}'::jsonb) || jsonb_build_object(
        'quotation_tax_context',v_quote.tax_snapshot->'taxContext',
        'quotation_tax_result',v_quote.tax_snapshot->'taxResult'
      ), updated_at=now()
      where id=v_invoice_id and workspace_id=p_workspace_id and status='draft';
    end if;
  end if;
  return v_result;
end;
$function$;

revoke all on function public.global_manage_quotation_with_tax(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.global_manage_quotation_with_tax(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,jsonb) to service_role;

commit;
