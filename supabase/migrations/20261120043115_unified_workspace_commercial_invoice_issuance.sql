-- Unified Main Workspace commercial invoice issuance for non-India countries.
-- This enables explicitly-attested commercial invoices only. It does not enable tax invoices.
-- India GST remains on the existing save_invoice path.
begin;

alter table public.invoices add column if not exists issue_request_key uuid;
alter table public.invoices add column if not exists issue_request_hash text;
create unique index if not exists invoices_workspace_issue_request_key_idx
  on public.invoices(workspace_id, issue_request_key) where issue_request_key is not null;

create table if not exists public.workspace_invoice_number_sequences (
  workspace_id text not null,
  invoice_year integer not null check (invoice_year between 2000 and 9999),
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, invoice_year)
);
alter table public.workspace_invoice_number_sequences enable row level security;
revoke all on public.workspace_invoice_number_sequences from public, anon, authenticated;
grant all on public.workspace_invoice_number_sequences to service_role;

-- Allow only the authenticated issuance RPC below to transition a non-India
-- invoice from draft to issued. Currency and zero-tax guards remain in force.
create or replace function public.enforce_workspace_invoice_currency()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_country text;
  v_currency text;
  v_access jsonb;
  v_multi_currency boolean := false;
  v_issuance boolean := current_user = 'postgres' and coalesce(current_setting('plivex.invoice_issuance', true), '') = 'on';
begin
  if new.currency is null then return new; end if;
  select country_code, currency_code into v_country, v_currency
  from public.workspace_settings where workspace_id = new.workspace_id;
  if v_country is null or v_currency is null then
    raise exception 'workspace_country_currency_unconfigured';
  end if;
  if upper(trim(new.currency)) not in ('INR','USD','EUR','GBP','AED','CAD','AUD','SGD') then
    raise exception 'unsupported_invoice_currency';
  end if;
  if upper(trim(new.currency)) <> v_currency then
    if v_country <> 'IN' then raise exception 'invoice_currency_must_match_workspace_base_currency'; end if;
    v_access := public.get_access_status(new.workspace_id);
    v_multi_currency := coalesce((v_access->'features'->>'multi_currency')::boolean, false);
    if not v_multi_currency then raise exception 'invoice_currency_must_match_workspace_base_currency'; end if;
  end if;
  if v_country <> 'IN' then
    if new.is_draft is distinct from true and not v_issuance then
      raise exception 'non_india_invoices_must_be_issued_through_verified_rpc';
    end if;
    if coalesce(new.tax_rate, 0) <> 0 or coalesce(new.cgst, 0) <> 0
      or coalesce(new.sgst, 0) <> 0 or coalesce(new.igst, 0) <> 0 then
      raise exception 'unverified_non_india_tax_components_not_allowed';
    end if;
    if exists (select 1 from public.invoice_items
      where invoice_id = new.id and coalesce(gst_rate, 0) <> 0) then
      raise exception 'india_gst_item_rates_not_allowed_for_non_india_workspace';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.guard_issued_workspace_invoice()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_country text;
begin
  if tg_op = 'DELETE' then
    select country_code into v_country from public.workspace_settings where workspace_id=old.workspace_id;
    if v_country='IN' then return old; end if;
    if old.is_draft is distinct from true then
      raise exception using errcode='55000', message='Issued invoices cannot be deleted';
    end if;
    return old;
  end if;
  select country_code into v_country from public.workspace_settings where workspace_id=old.workspace_id;
  if v_country='IN' then return new; end if;
  if old.is_draft is distinct from true then
    if new.is_draft is distinct from false
      or new.workspace_id is distinct from old.workspace_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or (old.stock_applied is true and new.stock_applied is distinct from true)
      or new.number is distinct from old.number
      or new.client_id is distinct from old.client_id
      or new.client_name is distinct from old.client_name
      or new.client_email is distinct from old.client_email
      or new.business_name is distinct from old.business_name
      or new.issue_date is distinct from old.issue_date
      or new.due_date is distinct from old.due_date
      or new.currency is distinct from old.currency
      or new.tax_mode is distinct from old.tax_mode
      or new.tax_rate is distinct from old.tax_rate
      or new.discount_type is distinct from old.discount_type
      or new.discount is distinct from old.discount
      or new.notes is distinct from old.notes
      or new.terms is distinct from old.terms
      or new.subtotal is distinct from old.subtotal
      or new.tax_value is distinct from old.tax_value
      or new.cgst is distinct from old.cgst
      or new.sgst is distinct from old.sgst
      or new.igst is distinct from old.igst
      or new.total is distinct from old.total
      or new.invoice_snapshot is distinct from old.invoice_snapshot
      or new.issue_request_key is distinct from old.issue_request_key
       or new.issue_request_hash is distinct from old.issue_request_hash then
      raise exception using errcode='55000', message='Issued invoice content is immutable; create a correction document';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_issued_workspace_invoice on public.invoices;
create trigger guard_issued_workspace_invoice
before update or delete on public.invoices
for each row execute function public.guard_issued_workspace_invoice();

create or replace function public.guard_issued_workspace_invoice_items()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_is_draft boolean;
  v_country text;
begin
  if tg_op='UPDATE' or tg_op='DELETE' then
    select i.is_draft,ws.country_code into v_is_draft,v_country
    from public.invoices i left join public.workspace_settings ws on ws.workspace_id=i.workspace_id
    where i.id=old.invoice_id for update of i;
    if not found and tg_op='DELETE' then return old; end if;
    if coalesce(v_country,'')<>'IN' and v_is_draft is distinct from true then
      raise exception using errcode='55000', message='Issued invoice lines are immutable';
    end if;
  end if;
  if tg_op='INSERT' or tg_op='UPDATE' then
    select i.is_draft,ws.country_code into v_is_draft,v_country
    from public.invoices i left join public.workspace_settings ws on ws.workspace_id=i.workspace_id
    where i.id=new.invoice_id for update of i;
    if coalesce(v_country,'')<>'IN' and v_is_draft is distinct from true then
      raise exception using errcode='55000', message='Issued invoice lines are immutable';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
drop trigger if exists guard_issued_workspace_invoice_items on public.invoice_items;
create trigger guard_issued_workspace_invoice_items
before insert or update or delete on public.invoice_items
for each row execute function public.guard_issued_workspace_invoice_items();

create or replace function public.save_and_issue_commercial_invoice(
  _data jsonb,
  _items jsonb,
  _idempotency_key uuid,
  _invoice_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_workspace text;
  v_role public.app_role;
  v_settings public.workspace_settings%rowtype;
  v_profile public.business_profile%rowtype;
  v_invoice public.invoices%rowtype;
  v_saved public.invoices%rowtype;
  v_client_id uuid;
  v_existing public.invoices%rowtype;
  v_snapshot jsonb;
  v_items jsonb;
  v_year integer;
  v_sequence bigint;
  v_number text;
  v_issue_date date;
  v_request_hash text;
begin
  if v_user is null then raise exception using errcode='42501', message='Please sign in'; end if;
  if _idempotency_key is null then raise exception using errcode='22023', message='An invoice issue request key is required'; end if;
  v_request_hash := md5(coalesce(_data,'{}'::jsonb)::text || '|' || coalesce(_items,'[]'::jsonb)::text);
  select workspace_id, role into v_workspace, v_role from public.profiles where id=v_user;
  if v_workspace is null or v_role not in ('admin','manager') then
    raise exception using errcode='42501', message='Only workspace admins or managers can issue invoices';
  end if;
  select * into v_settings from public.workspace_settings where workspace_id=v_workspace;
  select * into v_profile from public.business_profile where workspace_id=v_workspace;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace || ':commercial-invoice:' || _idempotency_key::text,0));
  select * into v_existing from public.invoices
  where workspace_id=v_workspace and issue_request_key=_idempotency_key
  for update;
  if found then
    if _invoice_id is not null and _invoice_id <> v_existing.id then
      raise exception using errcode='23505', message='Invoice issue request key is already assigned to another invoice';
    end if;
    if v_existing.is_draft then
      raise exception using errcode='55000', message='The previous invoice issue request is incomplete; keep this invoice as a draft and retry with a new request';
    end if;
    if v_existing.issue_request_hash is distinct from v_request_hash then
      raise exception using errcode='55000', message='Issued invoice content is immutable; create a correction document';
    end if;
    return jsonb_build_object('invoice',to_jsonb(v_existing),'issued',true,'duplicate',true);
  end if;

  if v_settings.country_code not in ('GB','US','AE','CA','AU','SG') then
    raise exception using errcode='22023', message='Commercial issuance is not enabled for this workspace country';
  end if;
  if (v_settings.country_code='GB' and v_settings.currency_code<>'GBP')
    or (v_settings.country_code='US' and v_settings.currency_code<>'USD')
    or (v_settings.country_code='AE' and v_settings.currency_code<>'AED')
    or (v_settings.country_code='CA' and v_settings.currency_code<>'CAD')
    or (v_settings.country_code='AU' and v_settings.currency_code<>'AUD')
    or (v_settings.country_code='SG' and v_settings.currency_code<>'SGD') then
    raise exception using errcode='22023', message='Workspace base currency does not match its country';
  end if;
  if nullif(btrim(v_profile.name),'') is null or nullif(btrim(v_profile.address),'') is null then
    raise exception using errcode='22023', message='Complete your legal business name and address in Workspace settings before issuing';
  end if;
  if nullif(btrim(coalesce(_data->>'client_name','')),'') is null then
    raise exception using errcode='22023', message='Customer name is required';
  end if;
  v_issue_date := coalesce(nullif(_data->>'issue_date','')::date, current_date);
  if nullif(_data->>'due_date','') is not null and (_data->>'due_date')::date < v_issue_date then
    raise exception using errcode='22023', message='Due date cannot be earlier than the issue date';
  end if;
  if jsonb_typeof(coalesce(_data->'invoice_snapshot'->'globalTax','null')) <> 'object'
    or coalesce(_data->'invoice_snapshot'->'globalTax'->>'taxMode','') <> 'no_tax'
    or coalesce((_data->'invoice_snapshot'->'globalTax'->>'noTaxConfirmed')::boolean,false) is not true then
    raise exception using errcode='22023', message='Confirm the applicable tax treatment before issuing a commercial invoice';
  end if;
  if jsonb_typeof(coalesce(_items,'null')) <> 'array' or jsonb_array_length(_items)<1 then
    raise exception using errcode='22023', message='At least one invoice item is required';
  end if;
  if exists(select 1 from jsonb_array_elements(_items) e
    where coalesce(nullif(e->>'quantity','')::numeric,0)<=0
      or coalesce(nullif(e->>'rate','')::numeric,-1)<0
      or coalesce(nullif(e->>'gst_rate','')::numeric,0)<>0
      or length(btrim(coalesce(e->>'description','')))=0) then
    raise exception using errcode='22023', message='Commercial invoice items contain invalid values';
  end if;

  -- Resolve or create the canonical CRM customer in the same transaction.
  if nullif(btrim(coalesce(_data->>'client_email','')),'') is not null then
    select id into v_client_id from public.clients
    where workspace_id=v_workspace and lower(email)=lower(btrim(_data->>'client_email'))
    order by created_at asc limit 1;
  end if;
  if v_client_id is null then
    insert into public.clients(workspace_id,name,company,email,phone,address)
    values(
      v_workspace,
      left(btrim(_data->>'client_name'),160),
      nullif(left(btrim(coalesce(_data->'invoice_snapshot'->'client'->>'company','')),160),''),
      nullif(lower(left(btrim(coalesce(_data->>'client_email','')),254)),''),
      nullif(left(btrim(coalesce(_data->'invoice_snapshot'->'client'->>'phone','')),40),''),
      nullif(left(btrim(coalesce(_data->'invoice_snapshot'->'client'->>'address','')),1000),'')
    ) returning id into v_client_id;
  end if;

  -- Create/update only a draft in the existing canonical public invoice ledger.
  v_saved := public.save_invoice(
    coalesce(_data,'{}'::jsonb) || jsonb_build_object(
      'is_draft',true,'tax_rate',0,'tax_mode','split','status','Pending',
      'currency',v_settings.currency_code
    ),
    _items,
    _invoice_id
  );
  if v_saved.id is null then raise exception 'Invoice draft could not be saved'; end if;
  select * into v_invoice from public.invoices where id=v_saved.id and workspace_id=v_workspace for update;
  if v_invoice.is_draft is distinct from true then
    raise exception using errcode='55000', message='Only a draft can be issued';
  end if;
  update public.invoices set client_id=v_client_id
  where id=v_invoice.id and workspace_id=v_workspace
  returning * into v_invoice;

  v_year := extract(year from v_issue_date)::integer;
  insert into public.workspace_invoice_number_sequences(workspace_id,invoice_year,last_number)
  values(v_workspace,v_year,1)
  on conflict(workspace_id,invoice_year) do update
    set last_number=public.workspace_invoice_number_sequences.last_number+1,updated_at=now()
  returning last_number into v_sequence;
  v_number := 'INV-'||v_settings.country_code||'-'||v_year::text||'-'||lpad(v_sequence::text,6,'0');

  select coalesce(jsonb_agg(jsonb_build_object(
    'description',ii.description,'quantity',ii.quantity,'rate',ii.rate,
    'line_total',round(ii.quantity*ii.rate,2)
  ) order by ii.id),'[]'::jsonb) into v_items
  from public.invoice_items ii where ii.invoice_id=v_invoice.id;

  v_snapshot := coalesce(_data->'invoice_snapshot','{}'::jsonb) || jsonb_build_object(
    'schemaVersion',1,
    'documentType','commercial_invoice',
    'documentStatus','issued',
    'document_type','commercial_invoice',
    'document_status','issued',
    'workspaceCountryCode',v_settings.country_code,
    'country_code',v_settings.country_code,
    'currency',v_settings.currency_code,
    'currency_code',v_settings.currency_code,
    'locale_code',v_settings.locale_code,
    'invoice_number',v_number,
    'issue_date',v_issue_date,
    'due_date',v_invoice.due_date,
    'taxStatus','not_assessed',
    'tax_status','not_assessed',
    'taxDisclosure','No tax has been calculated or validated by Plivex. The seller has confirmed that no tax is being charged on this commercial invoice and remains responsible for the applicable tax treatment.',
    'tax_disclosure','No tax has been calculated or validated by Plivex. The seller has confirmed that no tax is being charged on this commercial invoice and remains responsible for the applicable tax treatment.',
    'subtotal_minor',round(v_invoice.subtotal*100)::bigint,
    'discount_minor',round(v_invoice.discount*100)::bigint,
    'tax_minor',0,
    'total_minor',round(v_invoice.total*100)::bigint,
    'seller',jsonb_build_object(
      'legalName',v_profile.name,'legal_name',v_profile.name,'address',v_profile.address,
      'email',v_profile.email,'phone',v_profile.phone,
      'taxRegistrationNumber',v_profile.tax_registration_number,
      'tax_registration_number',v_profile.tax_registration_number,
      'taxRegistrationType',v_profile.tax_registration_type,
      'tax_registration_type',v_profile.tax_registration_type
    ),
    'buyer',coalesce(_data->'invoice_snapshot'->'client','{}'::jsonb),
    'items',v_items,
    'subtotal',v_invoice.subtotal,
    'discount',v_invoice.discount,
    'discountType',v_invoice.discount_type,
    'total',v_invoice.total,
    'invoiceNumber',v_number,
    'issueDate',v_issue_date,
    'finalizedAt',now(),
    'issuedBy',v_user
  );

  perform set_config('plivex.invoice_issuance','on',true);
  update public.invoices set
    number=v_number,is_draft=false,status='Pending',issue_request_key=_idempotency_key,issue_request_hash=v_request_hash,
    tax_rate=0,tax_value=0,cgst=0,sgst=0,igst=0,
    total=v_invoice.total,
    invoice_snapshot=v_snapshot,
    updated_at=now()
  where id=v_invoice.id and workspace_id=v_workspace
  returning * into v_invoice;

  -- Match the existing India invoice stock behavior: deduct only matching
  -- workspace stock names, once, after the invoice has been issued.
  if not v_invoice.stock_applied then
    update public.stock s set quantity = greatest(0, s.quantity - q.qty)
    from (
      select lower(trim(description)) d, sum(greatest(0, quantity)) qty
      from public.invoice_items where invoice_id = v_invoice.id group by 1
    ) q
    where s.workspace_id = v_workspace and lower(trim(s.name)) = q.d;
    update public.invoices set stock_applied = true
    where id = v_invoice.id and workspace_id = v_workspace
    returning * into v_invoice;
  end if;

  return jsonb_build_object('invoice',to_jsonb(v_invoice),'issued',true);
end;
$function$;

revoke all on function public.save_and_issue_commercial_invoice(jsonb,jsonb,uuid,uuid) from public, anon;
grant execute on function public.save_and_issue_commercial_invoice(jsonb,jsonb,uuid,uuid) to authenticated;

comment on function public.save_and_issue_commercial_invoice(jsonb,jsonb,uuid,uuid) is
  'Atomically saves and issues a non-India commercial invoice only after explicit no-tax attestation. Does not issue tax invoices.';

commit;
