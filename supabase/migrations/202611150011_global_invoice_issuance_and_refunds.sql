-- Part 5: Global invoice issuance, immutable tax snapshot and refund ledger.
-- Initial end-to-end issuance adapter: GB VAT standard-rated only.
-- Other Global countries remain draft-only until their jurisdiction rules pass review.
begin;

alter table global.invoices
  add column if not exists amount_refunded_minor bigint not null default 0
    check (amount_refunded_minor >= 0 and amount_refunded_minor <= amount_paid_minor),
  add column if not exists issuance_idempotency_key uuid;

alter table global.invoices drop constraint if exists invoices_status_check;
alter table global.invoices drop constraint if exists global_invoices_status_check;
alter table global.invoices add constraint global_invoices_status_check
  check (status in ('draft','issued','partially_paid','paid','overdue','cancelled','partially_refunded','refunded'));

create unique index if not exists global_invoices_issuance_idempotency_idx
  on global.invoices(workspace_id, issuance_idempotency_key)
  where issuance_idempotency_key is not null;

create table if not exists global.invoice_number_sequences (
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  invoice_year integer not null check (invoice_year between 2000 and 9999),
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, invoice_year)
);
alter table global.invoice_number_sequences enable row level security;
revoke all on global.invoice_number_sequences from public, anon, authenticated;
grant all on global.invoice_number_sequences to service_role;

create table if not exists global.invoice_refunds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  invoice_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  refund_date date not null,
  method text,
  reference text,
  reason text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, invoice_id) references global.invoices(workspace_id, id) on delete restrict,
  unique (workspace_id, idempotency_key)
);
create index if not exists global_invoice_refunds_workspace_invoice_idx
  on global.invoice_refunds(workspace_id, invoice_id, refund_date desc, created_at desc);
alter table global.invoice_refunds enable row level security;
drop policy if exists global_invoice_refunds_select_member on global.invoice_refunds;
create policy global_invoice_refunds_select_member on global.invoice_refunds
  for select to authenticated using (global.is_workspace_member(workspace_id));
revoke all on global.invoice_refunds from public, anon, authenticated;
grant select on global.invoice_refunds to authenticated;
grant all on global.invoice_refunds to service_role;

-- Issued invoice identity, totals and tax snapshot are immutable. Payment/refund
-- balances and lifecycle status remain mutable only through audited RPCs.
create or replace function global.guard_issued_invoice_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, global
as $function$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception using errcode = '55000', message = 'Issued invoices cannot be deleted';
    end if;
    return old;
  end if;

  if old.status <> 'draft' and (
    new.workspace_id is distinct from old.workspace_id
    or new.client_id is distinct from old.client_id
    or new.invoice_number is distinct from old.invoice_number
    or new.currency_code is distinct from old.currency_code
    or new.issue_date is distinct from old.issue_date
    or new.due_date is distinct from old.due_date
    or new.subtotal_minor is distinct from old.subtotal_minor
    or new.discount_minor is distinct from old.discount_minor
    or new.tax_minor is distinct from old.tax_minor
    or new.total_minor is distinct from old.total_minor
    or new.notes is distinct from old.notes
    or new.invoice_snapshot is distinct from old.invoice_snapshot
    or new.created_by is distinct from old.created_by
    or new.issuance_idempotency_key is distinct from old.issuance_idempotency_key
  ) then
    raise exception using errcode = '55000', message = 'Issued invoice content and tax snapshot are immutable';
  end if;
  if old.status <> 'draft' and new.amount_paid_minor < old.amount_paid_minor then
    raise exception using errcode = '55000', message = 'Recorded invoice payments cannot be reduced';
  end if;
  if old.status <> 'draft' and new.amount_refunded_minor < old.amount_refunded_minor then
    raise exception using errcode = '55000', message = 'Recorded invoice refunds cannot be reduced';
  end if;
  return new;
end;
$function$;

drop trigger if exists global_invoice_immutability_guard on global.invoices;
create trigger global_invoice_immutability_guard
  before update or delete on global.invoices
  for each row execute function global.guard_issued_invoice_immutability();

create or replace function global.guard_issued_invoice_items()
returns trigger
language plpgsql
set search_path = pg_catalog, global
as $function$
declare
  v_status text;
begin
  select status into v_status from global.invoices
  where workspace_id = coalesce(new.workspace_id, old.workspace_id)
    and id = coalesce(new.invoice_id, old.invoice_id)
  for update;
  if v_status is distinct from 'draft' then
    raise exception using errcode = '55000', message = 'Issued invoice lines are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
drop trigger if exists global_invoice_items_immutability_guard on global.invoice_items;
create trigger global_invoice_items_immutability_guard
  before insert or update or delete on global.invoice_items
  for each row execute function global.guard_issued_invoice_items();

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
  v_existing global.invoices%rowtype;
  v_item global.invoice_items%rowtype;
  v_line_base bigint;
  v_line_tax bigint;
  v_subtotal_after_discount bigint;
  v_tax bigint := 0;
  v_total bigint;
  v_taxable bigint;
  v_number bigint;
  v_invoice_number text;
  v_price_mode text;
  v_place text;
  v_tax_snapshot jsonb;
  v_items jsonb;
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

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':issue:' || p_idempotency_key::text,0));
  select * into v_existing from global.invoices
  where workspace_id=p_workspace_id and issuance_idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.id <> p_invoice_id then
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

  -- First release deliberately enables only GB standard-rated VAT.
  if v_workspace.country_code <> 'GB' or v_workspace.currency_code <> 'GBP'
    or v_profile.country_code <> 'GB' or v_profile.currency_code <> 'GBP' then
    return jsonb_build_object('ok',false,'reason','country_not_enabled');
  end if;
  if v_profile.tax_registration_status <> 'registered'
    or upper(coalesce(v_profile.tax_registration_type,'')) <> 'VAT'
    or nullif(btrim(v_profile.tax_registration_number),'') is null
    or v_profile.tax_registration_effective_from is null
    or v_invoice.issue_date < v_profile.tax_registration_effective_from
    or nullif(btrim(v_profile.legal_name),'') is null
    or nullif(btrim(v_profile.address),'') is null then
    return jsonb_build_object('ok',false,'reason','seller_profile_incomplete');
  end if;
  if coalesce((p_tax_context->>'registration_confirmed')::boolean,false) is not true
    or coalesce((p_tax_context->>'place_of_supply_confirmed')::boolean,false) is not true
    or coalesce((p_tax_context->>'tax_category_confirmed')::boolean,false) is not true
    or lower(coalesce(p_tax_context->>'tax_category','')) <> 'standard-rated'
    or coalesce(p_tax_context->>'mode','') <> 'automatic'
    or coalesce(p_tax_context->>'price_mode','') not in ('exclusive','inclusive')
    or lower(btrim(coalesce(p_tax_context->>'place_of_supply',''))) <> 'united kingdom' then
    return jsonb_build_object('ok',false,'reason','tax_evidence_incomplete');
  end if;
  if v_invoice.currency_code <> 'GBP' or v_invoice.subtotal_minor < v_invoice.discount_minor then
    return jsonb_build_object('ok',false,'reason','invalid_invoice_amounts');
  end if;

  v_price_mode := p_tax_context->>'price_mode';
  v_place := left(btrim(p_tax_context->>'place_of_supply'),180);
  v_subtotal_after_discount := v_invoice.subtotal_minor-v_invoice.discount_minor;

  for v_item in
    select * from global.invoice_items
    where workspace_id=p_workspace_id and invoice_id=p_invoice_id
    order by sort_order, id
    for update
  loop
    v_line_base := v_item.line_total_minor;
    if v_price_mode = 'inclusive' then
      v_line_tax := round(v_line_base::numeric * 2000 / 12000)::bigint;
    else
      v_line_tax := round(v_line_base::numeric * 2000 / 10000)::bigint;
    end if;
    v_tax := v_tax+v_line_tax;
    update global.invoice_items set tax_rate_bps=2000,tax_minor=v_line_tax,
      line_total_minor=case when v_price_mode='exclusive' then v_line_base+v_line_tax else v_line_base end
    where id=v_item.id and workspace_id=p_workspace_id;
  end loop;

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

  insert into global.invoice_number_sequences(workspace_id,invoice_year,last_number)
  values(p_workspace_id,extract(year from v_invoice.issue_date)::integer,1)
  on conflict(workspace_id,invoice_year) do update
    set last_number=global.invoice_number_sequences.last_number+1,updated_at=now()
  returning last_number into v_number;
  v_invoice_number := 'INV-GB-' || extract(year from v_invoice.issue_date)::integer::text || '-' || lpad(v_number::text,6,'0');

  v_tax_snapshot := jsonb_build_object(
    'document_status','issued',
    'country_code','GB',
    'currency_code','GBP',
    'tax_status','calculated',
    'tax_mode','automatic',
    'price_mode',v_price_mode,
    'tax_category','standard-rated',
    'place_of_supply',v_place,
    'registration_attested',true,
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
      'components',jsonb_build_array(jsonb_build_object(
        'id','GB-VAT-STANDARD-2026-11','name','VAT','rate_bps',2000,'amount_minor',v_tax
      )),
      'rule',jsonb_build_object(
        'id','GB-VAT-STANDARD-2026-11','version','2026.11',
        'source','https://www.gov.uk/vat-rates',
        'effective_from','2011-01-04','reviewed_on','2026-11-14'
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

create or replace function public.global_record_invoice_refund(
  p_user_id uuid,
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_amount_minor bigint,
  p_currency_code text,
  p_refund_date date,
  p_method text,
  p_reference text,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_invoice global.invoices%rowtype;
  v_existing global.invoice_refunds%rowtype;
  v_refund global.invoice_refunds%rowtype;
  v_available bigint;
  v_net_refunded bigint;
  v_status text;
begin
  if p_user_id is null or p_workspace_id is null or p_invoice_id is null or p_idempotency_key is null
    or p_amount_minor is null or p_amount_minor<=0 or p_refund_date is null
    or p_currency_code is null or length(p_currency_code) <> 3 or p_currency_code !~ '^[A-Z]{3}
    or coalesce(length(p_reason),0)>500 then
    return jsonb_build_object('ok',false,'reason','invalid_refund');
  end if;
  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','accountant') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':refund:' || p_idempotency_key::text,0));
  select * into v_existing from global.invoice_refunds
  where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.invoice_id<>p_invoice_id or v_existing.amount_minor<>p_amount_minor
      or v_existing.currency_code<>p_currency_code or v_existing.refund_date<>p_refund_date
      or coalesce(v_existing.method,'')<>coalesce(nullif(btrim(p_method),''),'')
      or coalesce(v_existing.reference,'')<>coalesce(nullif(btrim(p_reference),''),'')
      or coalesce(v_existing.reason,'')<>coalesce(nullif(btrim(p_reason),''),'') then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict');
    end if;
    select * into v_invoice from global.invoices where id=p_invoice_id and workspace_id=p_workspace_id;
    return jsonb_build_object('ok',true,'duplicate',true,'refund',to_jsonb(v_existing),'invoice',to_jsonb(v_invoice));
  end if;

  select * into v_invoice from global.invoices
  where id=p_invoice_id and workspace_id=p_workspace_id for update;
  if v_invoice.id is null then return jsonb_build_object('ok',false,'reason','invoice_not_found'); end if;
  if v_invoice.status not in ('issued','partially_paid','paid','partially_refunded','refunded') then
    return jsonb_build_object('ok',false,'reason','invoice_not_refundable');
  end if;
  if upper(p_currency_code)<>v_invoice.currency_code or p_refund_date<v_invoice.issue_date then
    return jsonb_build_object('ok',false,'reason','invalid_refund');
  end if;
  v_available := v_invoice.amount_paid_minor-v_invoice.amount_refunded_minor;
  if p_amount_minor>v_available then
    return jsonb_build_object('ok',false,'reason','refund_exceeds_net_payments','available_minor',v_available);
  end if;

  insert into global.invoice_refunds(
    workspace_id,invoice_id,amount_minor,currency_code,refund_date,method,reference,reason,recorded_by,idempotency_key
  ) values (
    p_workspace_id,p_invoice_id,p_amount_minor,v_invoice.currency_code,p_refund_date,
    nullif(btrim(p_method),''),nullif(btrim(p_reference),''),nullif(btrim(p_reason),''),p_user_id,p_idempotency_key
  ) returning * into v_refund;

  v_net_refunded := v_invoice.amount_refunded_minor+p_amount_minor;
  v_status := case when v_net_refunded=v_invoice.amount_paid_minor then 'refunded' else 'partially_refunded' end;
  update global.invoices set amount_refunded_minor=v_net_refunded,status=v_status,updated_at=now()
  where id=p_invoice_id and workspace_id=p_workspace_id returning * into v_invoice;

  return jsonb_build_object('ok',true,'duplicate',false,'refund',to_jsonb(v_refund),'invoice',to_jsonb(v_invoice));
end;
$function$;

-- Reconciliation is a read-only, member-scoped projection over the ledgers.
create or replace view global.invoice_reconciliation
with (security_invoker = true) as
select i.workspace_id,i.id as invoice_id,i.invoice_number,i.currency_code,i.status,
  i.total_minor,i.amount_paid_minor as gross_payments_minor,
  i.amount_refunded_minor as refunds_minor,
  i.amount_paid_minor-i.amount_refunded_minor as net_received_minor,
  i.total_minor-(i.amount_paid_minor-i.amount_refunded_minor) as outstanding_minor,
  coalesce(p.payment_count,0) as payment_count,
  coalesce(r.refund_count,0) as refund_count
from global.invoices i
left join (
  select workspace_id,invoice_id,count(*) as payment_count
  from global.invoice_payments group by workspace_id,invoice_id
) p on p.workspace_id=i.workspace_id and p.invoice_id=i.id
left join (
  select workspace_id,invoice_id,count(*) as refund_count
  from global.invoice_refunds group by workspace_id,invoice_id
) r on r.workspace_id=i.workspace_id and r.invoice_id=i.id;

grant select on global.invoice_reconciliation to authenticated, service_role;

revoke all on function public.global_issue_invoice(uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.global_record_invoice_refund(uuid,uuid,uuid,bigint,text,date,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.global_issue_invoice(uuid,uuid,uuid,jsonb,uuid) to service_role;
grant execute on function public.global_record_invoice_refund(uuid,uuid,uuid,bigint,text,date,text,text,text,uuid) to service_role;

comment on table global.invoice_refunds is 'Append-only Global invoice refund ledger; amount_refunded_minor tracks successful recorded refunds.';
comment on view global.invoice_reconciliation is 'Member-scoped Global invoice payment/refund reconciliation; net received is gross payments less refunds.';

-- Refund rows are an append-only audit ledger.
create or replace function global.guard_invoice_refund_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '55000', message = 'Invoice refund ledger rows are append-only';
end;
$function$;
drop trigger if exists global_invoice_refunds_append_only on global.invoice_refunds;
create trigger global_invoice_refunds_append_only
  before update or delete on global.invoice_refunds
  for each row execute function global.guard_invoice_refund_append_only();

create or replace function public.global_list_invoice_reconciliation(
  p_user_id uuid,
  p_workspace_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_records jsonb;
  v_limit integer := greatest(1,least(coalesce(p_limit,100),200));
begin
  if p_user_id is null or p_workspace_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_identity');
  end if;
  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.invoice_id),'[]'::jsonb)
  into v_records
  from (
    select * from global.invoice_reconciliation
    where workspace_id=p_workspace_id
    order by invoice_id desc
    limit v_limit
  ) t;
  return jsonb_build_object('ok',true,'records',v_records);
end;
$function$;

revoke all on function public.global_list_invoice_reconciliation(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.global_list_invoice_reconciliation(uuid,uuid,integer) to service_role;

commit;
