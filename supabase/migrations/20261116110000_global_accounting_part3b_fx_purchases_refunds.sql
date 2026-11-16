-- Part 3B: FX-aware purchasing, realized/unrealized FX, and refund journals.
-- All monetary postings remain in workspace functional currency; original currency/rates are retained.
begin;

alter table global.journal_entries drop constraint if exists journal_entries_source_type_check;
alter table global.journal_entries drop constraint if exists global_journal_entries_source_type_check;
alter table global.journal_entries add constraint global_journal_entries_source_type_check
  check (source_type in ('manual','opening_balance','invoice_issued','invoice_payment','invoice_refund','expense','purchase','purchase_payment','fx_revaluation','stock_adjustment'));

create or replace function global.seed_default_chart_of_accounts(p_workspace_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,global as $function$
begin
  insert into global.accounting_accounts(workspace_id,code,name,account_type,normal_balance,is_system)
  values
    (p_workspace_id,'1300','Recoverable Purchase Tax','asset','debit',true),
    (p_workspace_id,'4050','Sales Returns & Allowances','revenue','credit',true),
    (p_workspace_id,'4200','Foreign Exchange Gain','revenue','credit',true),
    (p_workspace_id,'6200','Foreign Exchange Loss','expense','debit',true)
  on conflict(workspace_id,code) do nothing;
end;
$function$;
do $seed$
declare r record;
begin
  for r in select id from global.workspaces loop
    perform global.seed_default_chart_of_accounts(r.id);
  end loop;
end;
$seed$;

create table if not exists global.suppliers(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  name text not null check(length(btrim(name)) between 1 and 200),
  email text,
  phone text,
  tax_registration_number text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(workspace_id,id)
);
create unique index if not exists global_suppliers_workspace_name_idx on global.suppliers(workspace_id,lower(name));

create table if not exists global.purchase_bills(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  supplier_id uuid not null,
  supplier_invoice_number text not null check(length(btrim(supplier_invoice_number)) between 1 and 80),
  purchase_date date not null,
  due_date date,
  currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),
  subtotal_minor bigint not null check(subtotal_minor>0),
  tax_minor bigint not null default 0 check(tax_minor>=0),
  tax_recoverable_minor bigint not null default 0 check(tax_recoverable_minor between 0 and tax_minor),
  total_minor bigint generated always as (subtotal_minor+tax_minor) stored,
  base_currency_code text not null check(base_currency_code ~ '^[A-Z]{3}$'),
  base_subtotal_minor bigint not null check(base_subtotal_minor>0),
  base_tax_minor bigint not null default 0 check(base_tax_minor>=0),
  base_tax_recoverable_minor bigint not null default 0 check(base_tax_recoverable_minor between 0 and base_tax_minor),
  base_total_minor bigint generated always as (base_subtotal_minor+base_tax_minor) stored,
  fx_rate_numerator bigint not null check(fx_rate_numerator>0),
  fx_rate_denominator bigint not null check(fx_rate_denominator>0),
  fx_rate_date date not null,
  fx_rate_source text not null check(length(btrim(fx_rate_source)) between 1 and 240),
  amount_paid_minor bigint not null default 0 check(amount_paid_minor between 0 and total_minor),
  base_amount_paid_minor bigint not null default 0 check(base_amount_paid_minor>=0),
  base_outstanding_minor bigint not null default 0 check(base_outstanding_minor>=0),
  carrying_fx_rate_numerator bigint,
  carrying_fx_rate_denominator bigint,
  carrying_fx_rate_date date,
  status text not null default 'draft' check(status in ('draft','posted','partially_paid','paid')),
  memo text,
  idempotency_key uuid not null,
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{32}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(workspace_id,id),
  unique(workspace_id,idempotency_key),
  foreign key(workspace_id,supplier_id) references global.suppliers(workspace_id,id) on delete restrict,
  check((currency_code=base_currency_code and fx_rate_numerator=fx_rate_denominator)
    or currency_code<>base_currency_code)
);
create index if not exists global_purchase_bills_workspace_date_idx
  on global.purchase_bills(workspace_id,purchase_date desc,created_at desc);
create index if not exists global_purchase_bills_open_idx
  on global.purchase_bills(workspace_id,status) where status in ('posted','partially_paid');

create table if not exists global.purchase_bill_lines(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  purchase_bill_id uuid not null,
  product_id uuid not null,
  description text not null check(length(btrim(description)) between 1 and 300),
  quantity numeric(18,4) not null check(quantity>0),
  unit_cost_minor bigint not null check(unit_cost_minor>0),
  line_total_minor bigint not null check(line_total_minor>0),
  base_line_total_minor bigint not null check(base_line_total_minor>0),
  created_at timestamptz not null default now(),
  foreign key(workspace_id,purchase_bill_id) references global.purchase_bills(workspace_id,id) on delete restrict,
  foreign key(workspace_id,product_id) references global.products(workspace_id,id) on delete restrict
);
create index if not exists global_purchase_bill_lines_bill_idx on global.purchase_bill_lines(workspace_id,purchase_bill_id);

create table if not exists global.purchase_bill_payments(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  purchase_bill_id uuid not null,
  amount_minor bigint not null check(amount_minor>0),
  currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),
  base_amount_minor bigint not null check(base_amount_minor>0),
  base_liability_settled_minor bigint not null check(base_liability_settled_minor>0),
  fx_rate_numerator bigint not null check(fx_rate_numerator>0),
  fx_rate_denominator bigint not null check(fx_rate_denominator>0),
  fx_rate_date date not null,
  fx_rate_source text not null check(length(btrim(fx_rate_source)) between 1 and 240),
  payment_date date not null,
  method text,
  reference text,
  idempotency_key uuid not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,purchase_bill_id) references global.purchase_bills(workspace_id,id) on delete restrict,
  unique(workspace_id,idempotency_key)
);
create index if not exists global_purchase_bill_payments_bill_idx
  on global.purchase_bill_payments(workspace_id,purchase_bill_id,payment_date desc);

create table if not exists global.purchase_fx_revaluations(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  purchase_bill_id uuid not null,
  revaluation_date date not null,
  previous_base_outstanding_minor bigint not null check(previous_base_outstanding_minor>=0),
  new_base_outstanding_minor bigint not null check(new_base_outstanding_minor>=0),
  fx_rate_numerator bigint not null check(fx_rate_numerator>0),
  fx_rate_denominator bigint not null check(fx_rate_denominator>0),
  fx_rate_source text not null check(length(btrim(fx_rate_source)) between 1 and 240),
  idempotency_key uuid not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,purchase_bill_id) references global.purchase_bills(workspace_id,id) on delete restrict,
  unique(workspace_id,idempotency_key)
);

alter table global.suppliers enable row level security;
alter table global.purchase_bills enable row level security;
alter table global.purchase_bill_lines enable row level security;
alter table global.purchase_bill_payments enable row level security;
alter table global.purchase_fx_revaluations enable row level security;
drop policy if exists global_suppliers_select_member on global.suppliers;
create policy global_suppliers_select_member on global.suppliers for select to authenticated using(global.is_workspace_member(workspace_id));
drop policy if exists global_purchase_bills_select_member on global.purchase_bills;
create policy global_purchase_bills_select_member on global.purchase_bills for select to authenticated using(global.is_workspace_member(workspace_id));
drop policy if exists global_purchase_lines_select_member on global.purchase_bill_lines;
create policy global_purchase_lines_select_member on global.purchase_bill_lines for select to authenticated using(global.is_workspace_member(workspace_id));
drop policy if exists global_purchase_payments_select_member on global.purchase_bill_payments;
create policy global_purchase_payments_select_member on global.purchase_bill_payments for select to authenticated using(global.is_workspace_member(workspace_id));
drop policy if exists global_purchase_fx_select_member on global.purchase_fx_revaluations;
create policy global_purchase_fx_select_member on global.purchase_fx_revaluations for select to authenticated using(global.is_workspace_member(workspace_id));
revoke all on global.suppliers,global.purchase_bills,global.purchase_bill_lines,global.purchase_bill_payments,global.purchase_fx_revaluations from public,anon,authenticated;
grant select on global.suppliers,global.purchase_bills,global.purchase_bill_lines,global.purchase_bill_payments,global.purchase_fx_revaluations to authenticated;
grant all on global.suppliers,global.purchase_bills,global.purchase_bill_lines,global.purchase_bill_payments,global.purchase_fx_revaluations to service_role;

create or replace function global.guard_posted_purchase_bill()
returns trigger language plpgsql set search_path=pg_catalog,global as $function$
begin
  if old.status<>'draft' then
    if tg_op='DELETE' then raise exception using errcode='55000',message='Posted purchase bills cannot be deleted'; end if;
    if new.workspace_id is distinct from old.workspace_id or new.supplier_id is distinct from old.supplier_id
      or new.supplier_invoice_number is distinct from old.supplier_invoice_number
      or new.purchase_date is distinct from old.purchase_date or new.due_date is distinct from old.due_date
      or new.currency_code is distinct from old.currency_code or new.subtotal_minor is distinct from old.subtotal_minor
      or new.tax_minor is distinct from old.tax_minor or new.tax_recoverable_minor is distinct from old.tax_recoverable_minor
      or new.base_currency_code is distinct from old.base_currency_code
      or new.base_subtotal_minor is distinct from old.base_subtotal_minor or new.base_tax_minor is distinct from old.base_tax_minor
      or new.base_tax_recoverable_minor is distinct from old.base_tax_recoverable_minor
      or new.fx_rate_numerator is distinct from old.fx_rate_numerator or new.fx_rate_denominator is distinct from old.fx_rate_denominator
      or new.fx_rate_date is distinct from old.fx_rate_date or new.fx_rate_source is distinct from old.fx_rate_source
      or new.idempotency_key is distinct from old.idempotency_key or new.request_fingerprint is distinct from old.request_fingerprint
      or new.created_by is distinct from old.created_by then
      raise exception using errcode='55000',message='Posted purchase bill content is immutable';
    end if;
    if new.amount_paid_minor<old.amount_paid_minor or new.base_amount_paid_minor<old.base_amount_paid_minor then
      raise exception using errcode='55000',message='Purchase payment totals cannot be reduced';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
drop trigger if exists global_purchase_bill_guard on global.purchase_bills;
create trigger global_purchase_bill_guard before update or delete on global.purchase_bills for each row execute function global.guard_posted_purchase_bill();

create or replace function global.guard_posted_purchase_lines()
returns trigger language plpgsql set search_path=pg_catalog,global as $function$
declare v_status text; v_id uuid; v_ws uuid;
begin
  v_id:=coalesce(new.purchase_bill_id,old.purchase_bill_id); v_ws:=coalesce(new.workspace_id,old.workspace_id);
  select status into v_status from global.purchase_bills where workspace_id=v_ws and id=v_id for update;
  if v_status is distinct from 'draft' then raise exception using errcode='55000',message='Posted purchase bill lines are immutable'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end;
$function$;
drop trigger if exists global_purchase_lines_guard on global.purchase_bill_lines;
create trigger global_purchase_lines_guard before insert or update or delete on global.purchase_bill_lines for each row execute function global.guard_posted_purchase_lines();

create or replace function global.guard_purchase_payment_append_only()
returns trigger language plpgsql set search_path=pg_catalog as $function$
begin raise exception using errcode='55000',message='Purchase payment rows are append-only'; end;
$function$;
drop trigger if exists global_purchase_payments_append_only on global.purchase_bill_payments;
create trigger global_purchase_payments_append_only before update or delete on global.purchase_bill_payments for each row execute function global.guard_purchase_payment_append_only();
drop trigger if exists global_purchase_fx_append_only on global.purchase_fx_revaluations;
create trigger global_purchase_fx_append_only before update or delete on global.purchase_fx_revaluations for each row execute function global.guard_purchase_payment_append_only();

create or replace function global.accounting_after_invoice_refund()
returns trigger language plpgsql security definer set search_path=pg_catalog,global as $function$
declare v_invoice global.invoices%rowtype; v_prior bigint; v_new bigint; v_tax_delta bigint; v_revenue bigint; v_cash text; v_lines jsonb; v_result jsonb;
begin
  select * into v_invoice from global.invoices where workspace_id=new.workspace_id and id=new.invoice_id;
  v_prior:=v_invoice.amount_refunded_minor;
  v_new:=v_prior+new.amount_minor;
  v_tax_delta:=case when v_invoice.total_minor>0 then
    round(v_new::numeric*v_invoice.tax_minor/v_invoice.total_minor)::bigint
      - round(v_prior::numeric*v_invoice.tax_minor/v_invoice.total_minor)::bigint else 0 end;
  v_revenue:=new.amount_minor-v_tax_delta;
  v_cash:=case when lower(coalesce(new.method,'')) like '%cash%' then '1000' else '1010' end;
  v_lines:='[]'::jsonb;
  if v_revenue>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code','4050','debit_minor',v_revenue,'credit_minor',0,'description','Sales return / refund')); end if;
  if v_tax_delta>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code','2100','debit_minor',v_tax_delta,'credit_minor',0,'description','Tax reversed on refund')); end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code',v_cash,'debit_minor',0,'credit_minor',new.amount_minor,'description','Refund paid'));
  v_result:=public.global_post_journal_entry(new.recorded_by,new.workspace_id,new.refund_date,new.currency_code,
    'Invoice refund · '||v_invoice.invoice_number,'invoice_refund',new.id,v_lines,
    md5(new.workspace_id::text||':invoice_refund:'||new.id::text)::uuid);
  if not coalesce((v_result->>'ok')::boolean,false) then
    raise exception using errcode='55000',message='Invoice refund accounting failed: '||coalesce(v_result->>'reason','unknown');
  end if;
  return new;
end;
$function$;
revoke all on function global.accounting_after_invoice_refund() from public,anon,authenticated;
drop trigger if exists global_invoice_refund_accounting on global.invoice_refunds;
create trigger global_invoice_refund_accounting after insert on global.invoice_refunds for each row execute function global.accounting_after_invoice_refund();

create or replace function public.global_create_purchase_bill(
  p_user_id uuid,p_workspace_id uuid,p_supplier_name text,p_supplier_email text,p_supplier_tax_id text,
  p_supplier_invoice_number text,p_purchase_date date,p_due_date date,p_currency_code text,
  p_subtotal_minor bigint,p_tax_minor bigint,p_tax_recoverable_minor bigint,
  p_base_subtotal_minor bigint,p_base_tax_minor bigint,p_base_tax_recoverable_minor bigint,
  p_fx_rate_numerator bigint,p_fx_rate_denominator bigint,p_fx_rate_date date,p_fx_rate_source text,
  p_lines jsonb,p_memo text,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global as $function$
declare v_role text; v_base text; v_supplier global.suppliers%rowtype; v_bill global.purchase_bills%rowtype;
  v_line jsonb; v_product global.products%rowtype; v_sum bigint:=0; v_base_sum bigint:=0; v_count int:=0; v_fingerprint text;
begin
  if p_user_id is null or p_workspace_id is null or p_idempotency_key is null or p_purchase_date is null
    or p_supplier_name is null or length(btrim(p_supplier_name)) not between 1 and 200
    or p_supplier_invoice_number is null or length(btrim(p_supplier_invoice_number)) not between 1 and 80
    or p_currency_code !~ '^[A-Z]{3}$' or p_subtotal_minor<=0 or p_tax_minor<0
    or p_tax_recoverable_minor<0 or p_tax_recoverable_minor>p_tax_minor
    or p_base_subtotal_minor<=0 or p_base_tax_minor<0 or p_base_tax_recoverable_minor<0
    or p_base_tax_recoverable_minor>p_base_tax_minor
    or p_fx_rate_numerator<=0 or p_fx_rate_denominator<=0 or p_fx_rate_date is null
    or p_fx_rate_source is null or length(btrim(p_fx_rate_source)) not between 1 and 240
    or jsonb_typeof(coalesce(p_lines,'null'))<>'array' or jsonb_array_length(case when jsonb_typeof(p_lines)='array' then p_lines else '[]'::jsonb end) not between 1 and 100 then
    return jsonb_build_object('ok',false,'reason','invalid_purchase');
  end if;
  select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active';
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','accountant','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select currency_code into v_base from global.workspaces where id=p_workspace_id;
  if v_base is null then return jsonb_build_object('ok',false,'reason','workspace_not_found'); end if;
  if p_currency_code=v_base and p_fx_rate_numerator<>p_fx_rate_denominator then return jsonb_build_object('ok',false,'reason','invalid_fx_rate'); end if;
  if p_currency_code<>v_base and p_fx_rate_numerator=p_fx_rate_denominator then return jsonb_build_object('ok',false,'reason','invalid_fx_rate'); end if;
  if round(p_tax_minor::numeric*p_fx_rate_numerator/p_fx_rate_denominator)::bigint<>p_base_tax_minor
    or round(p_tax_recoverable_minor::numeric*p_fx_rate_numerator/p_fx_rate_denominator)::bigint<>p_base_tax_recoverable_minor then
    return jsonb_build_object('ok',false,'reason','fx_conversion_mismatch');
  end if;
  v_fingerprint:=md5(jsonb_build_object('supplier',lower(btrim(p_supplier_name)),'supplier_invoice_number',btrim(p_supplier_invoice_number),
    'purchase_date',p_purchase_date,'currency',p_currency_code,'subtotal',p_subtotal_minor,'tax',p_tax_minor,
    'tax_recoverable',p_tax_recoverable_minor,'base_subtotal',p_base_subtotal_minor,'base_tax',p_base_tax_minor,
    'base_tax_recoverable',p_base_tax_recoverable_minor,'rate_num',p_fx_rate_numerator,'rate_den',p_fx_rate_denominator,
    'rate_date',p_fx_rate_date,'rate_source',p_fx_rate_source,'lines',p_lines)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':purchase:'||p_idempotency_key::text,0));
  select * into v_bill from global.purchase_bills where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_bill.request_fingerprint<>v_fingerprint then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
    return jsonb_build_object('ok',true,'duplicate',true,'purchase_bill',to_jsonb(v_bill));
  end if;
  insert into global.suppliers(workspace_id,name,email,tax_registration_number,created_by)
  values(p_workspace_id,btrim(p_supplier_name),nullif(btrim(p_supplier_email),''),nullif(btrim(p_supplier_tax_id),''),p_user_id)
  on conflict(workspace_id,(lower(name))) do update set email=coalesce(excluded.email,global.suppliers.email),
    tax_registration_number=coalesce(excluded.tax_registration_number,global.suppliers.tax_registration_number)
  returning * into v_supplier;
  insert into global.purchase_bills(workspace_id,supplier_id,supplier_invoice_number,purchase_date,due_date,currency_code,
    subtotal_minor,tax_minor,tax_recoverable_minor,base_currency_code,base_subtotal_minor,base_tax_minor,
    base_tax_recoverable_minor,fx_rate_numerator,fx_rate_denominator,fx_rate_date,fx_rate_source,
    carrying_fx_rate_numerator,carrying_fx_rate_denominator,carrying_fx_rate_date,
    idempotency_key,request_fingerprint,created_by,memo)
  values(p_workspace_id,v_supplier.id,btrim(p_supplier_invoice_number),p_purchase_date,p_due_date,p_currency_code,
    p_subtotal_minor,p_tax_minor,p_tax_recoverable_minor,v_base,p_base_subtotal_minor,p_base_tax_minor,
    p_base_tax_recoverable_minor,p_fx_rate_numerator,p_fx_rate_denominator,p_fx_rate_date,btrim(p_fx_rate_source),
    p_fx_rate_numerator,p_fx_rate_denominator,p_fx_rate_date,p_idempotency_key,v_fingerprint,p_user_id,left(p_memo,500))
  returning * into v_bill;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_count:=v_count+1;
    if (v_line->>'product_id') is null or (v_line->>'quantity') is null or (v_line->>'unit_cost_minor') is null
      or (v_line->>'line_total_minor') is null or (v_line->>'base_line_total_minor') is null then
      raise exception using errcode='22023',message='Invalid purchase line';
    end if;
    select * into v_product from global.products where workspace_id=p_workspace_id and id=(v_line->>'product_id')::uuid and is_active=true;
    if v_product.id is null or v_product.currency_code<>v_base then raise exception using errcode='22023',message='Purchase product must belong to this workspace and use its base currency'; end if;
    if round((v_line->>'quantity')::numeric*(v_line->>'unit_cost_minor')::numeric)::bigint<>(v_line->>'line_total_minor')::bigint
      or round((v_line->>'line_total_minor')::numeric*p_fx_rate_numerator/p_fx_rate_denominator)::bigint<>(v_line->>'base_line_total_minor')::bigint then
      raise exception using errcode='22023',message='Purchase line total or FX conversion is inconsistent';
    end if;
    v_sum:=v_sum+(v_line->>'line_total_minor')::bigint;
    v_base_sum:=v_base_sum+(v_line->>'base_line_total_minor')::bigint;
    insert into global.purchase_bill_lines(workspace_id,purchase_bill_id,product_id,description,quantity,unit_cost_minor,line_total_minor,base_line_total_minor)
    values(p_workspace_id,v_bill.id,v_product.id,left(coalesce(v_line->>'description',v_product.name),300),
      (v_line->>'quantity')::numeric,(v_line->>'unit_cost_minor')::bigint,(v_line->>'line_total_minor')::bigint,(v_line->>'base_line_total_minor')::bigint);
  end loop;
  if v_sum<>p_subtotal_minor or v_base_sum<>p_base_subtotal_minor then raise exception using errcode='22023',message='Purchase lines do not reconcile to bill subtotal'; end if;
  if p_currency_code=v_base and (p_base_subtotal_minor<>p_subtotal_minor or p_base_tax_minor<>p_tax_minor) then
    raise exception using errcode='22023',message='Base-currency purchase totals must match source totals';
  end if;
  return jsonb_build_object('ok',true,'duplicate',false,'purchase_bill',to_jsonb(v_bill),'supplier',to_jsonb(v_supplier));
end;
$function$;

create or replace function global.accounting_after_purchase_posted()
returns trigger language plpgsql security definer set search_path=pg_catalog,global as $function$
declare v_result jsonb; v_lines jsonb; v_inventory bigint; v_recoverable bigint; v_product record;
begin
  if old.status='draft' and new.status='posted' then
    if not exists(select 1 from global.purchase_bill_lines where workspace_id=new.workspace_id and purchase_bill_id=new.id) then
      raise exception using errcode='55000',message='Purchase bill has no inventory lines';
    end if;
    v_recoverable:=new.base_tax_recoverable_minor;
    v_inventory:=new.base_subtotal_minor+(new.base_tax_minor-new.base_tax_recoverable_minor);
    v_lines:=jsonb_build_array(jsonb_build_object('account_code','1200','debit_minor',v_inventory,'credit_minor',0,'description','Inventory purchase'));
    if v_recoverable>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code','1300','debit_minor',v_recoverable,'credit_minor',0,'description','Recoverable purchase tax')); end if;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code','2000','debit_minor',0,'credit_minor',new.base_total_minor,'description','Supplier payable'));
    v_result:=public.global_post_journal_entry(new.created_by,new.workspace_id,new.purchase_date,new.base_currency_code,
      'Purchase bill · '||new.supplier_invoice_number,'purchase',new.id,v_lines,
      md5(new.workspace_id::text||':purchase:'||new.id::text)::uuid);
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception using errcode='55000',message='Purchase posting failed: '||coalesce(v_result->>'reason','unknown'); end if;
    update global.purchase_bills set base_outstanding_minor=new.base_total_minor,posted_at=now() where workspace_id=new.workspace_id and id=new.id;
    for v_product in select l.product_id,l.quantity from global.purchase_bill_lines l where l.workspace_id=new.workspace_id and l.purchase_bill_id=new.id loop
      insert into global.stock_levels(workspace_id,product_id,quantity,reorder_level)
      values(new.workspace_id,v_product.product_id,v_product.quantity,0)
      on conflict(workspace_id,product_id) do update set quantity=global.stock_levels.quantity+excluded.quantity,updated_at=now();
      insert into global.stock_movements(workspace_id,product_id,movement_type,quantity_delta,reference_type,reference_id,notes,created_by)
      values(new.workspace_id,v_product.product_id,'receipt',v_product.quantity,'purchase_bill',new.id,'Posted purchase bill '||new.supplier_invoice_number,new.created_by);
    end loop;
  end if;
  return new;
end;
$function$;
revoke all on function global.accounting_after_purchase_posted() from public,anon,authenticated;
drop trigger if exists global_purchase_post_accounting on global.purchase_bills;
create trigger global_purchase_post_accounting after update of status on global.purchase_bills for each row execute function global.accounting_after_purchase_posted();

create or replace function global.accounting_after_purchase_payment()
returns trigger language plpgsql security definer set search_path=pg_catalog,global as $function$
declare v_bill global.purchase_bills%rowtype; v_lines jsonb; v_delta bigint; v_cash text; v_result jsonb;
begin
  select * into v_bill from global.purchase_bills where workspace_id=new.workspace_id and id=new.purchase_bill_id;
  v_cash:=case when lower(coalesce(new.method,'')) like '%cash%' then '1000' else '1010' end;
  v_lines:=jsonb_build_array(jsonb_build_object('account_code','2000','debit_minor',new.base_liability_settled_minor,'credit_minor',0,'description','Supplier payable settled'));
  v_delta:=new.base_amount_minor-new.base_liability_settled_minor;
  if v_delta>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code','6200','debit_minor',v_delta,'credit_minor',0,'description','Realized foreign exchange loss'));
  elsif v_delta<0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code','4200','debit_minor',0,'credit_minor',-v_delta,'description','Realized foreign exchange gain')); end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code',v_cash,'debit_minor',0,'credit_minor',new.base_amount_minor,'description','Supplier payment'));
  v_result:=public.global_post_journal_entry(new.recorded_by,new.workspace_id,new.payment_date,v_bill.base_currency_code,
    'Purchase payment · '||v_bill.supplier_invoice_number,'purchase_payment',new.id,v_lines,
    md5(new.workspace_id::text||':purchase_payment:'||new.id::text)::uuid);
  if not coalesce((v_result->>'ok')::boolean,false) then raise exception using errcode='55000',message='Purchase payment accounting failed: '||coalesce(v_result->>'reason','unknown'); end if;
  return new;
end;
$function$;
revoke all on function global.accounting_after_purchase_payment() from public,anon,authenticated;
drop trigger if exists global_purchase_payment_accounting on global.purchase_bill_payments;
create trigger global_purchase_payment_accounting after insert on global.purchase_bill_payments for each row execute function global.accounting_after_purchase_payment();

create or replace function public.global_post_purchase_bill(p_user_id uuid,p_workspace_id uuid,p_purchase_bill_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global as $function$
declare v_role text; v_bill global.purchase_bills%rowtype;
begin
  select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active';
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','accountant') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select * into v_bill from global.purchase_bills where workspace_id=p_workspace_id and id=p_purchase_bill_id for update;
  if v_bill.id is null then return jsonb_build_object('ok',false,'reason','purchase_not_found'); end if;
  if v_bill.status<>'draft' then return jsonb_build_object('ok',true,'duplicate',true,'purchase_bill',to_jsonb(v_bill)); end if;
  update global.purchase_bills set status='posted' where workspace_id=p_workspace_id and id=p_purchase_bill_id returning * into v_bill;
  return jsonb_build_object('ok',true,'duplicate',false,'purchase_bill',to_jsonb(v_bill));
end;
$function$;

create or replace function public.global_record_purchase_payment(
  p_user_id uuid,p_workspace_id uuid,p_purchase_bill_id uuid,p_amount_minor bigint,p_currency_code text,
  p_base_amount_minor bigint,p_fx_rate_numerator bigint,p_fx_rate_denominator bigint,p_fx_rate_date date,
  p_fx_rate_source text,p_payment_date date,p_method text,p_reference text,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global as $function$
declare v_role text; v_bill global.purchase_bills%rowtype; v_existing global.purchase_bill_payments%rowtype;
  v_remaining bigint; v_carrying bigint; v_payment global.purchase_bill_payments%rowtype; v_new_paid bigint; v_new_base_paid bigint;
begin
  if p_user_id is null or p_workspace_id is null or p_purchase_bill_id is null or p_amount_minor<=0
    or p_base_amount_minor<=0 or p_currency_code !~ '^[A-Z]{3}$' or p_fx_rate_numerator<=0 or p_fx_rate_denominator<=0
    or p_fx_rate_date is null or p_fx_rate_source is null or length(btrim(p_fx_rate_source)) not between 1 and 240
    or p_payment_date is null or p_idempotency_key is null then return jsonb_build_object('ok',false,'reason','invalid_payment'); end if;
  select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active';
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','accountant') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':purchase-payment:'||p_idempotency_key::text,0));
  select * into v_existing from global.purchase_bill_payments where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.purchase_bill_id<>p_purchase_bill_id or v_existing.amount_minor<>p_amount_minor or v_existing.base_amount_minor<>p_base_amount_minor
      or v_existing.currency_code<>p_currency_code or v_existing.fx_rate_numerator<>p_fx_rate_numerator
      or v_existing.fx_rate_denominator<>p_fx_rate_denominator then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
    return jsonb_build_object('ok',true,'duplicate',true,'payment',to_jsonb(v_existing));
  end if;
  select * into v_bill from global.purchase_bills where workspace_id=p_workspace_id and id=p_purchase_bill_id for update;
  if v_bill.id is null or v_bill.status='draft' then return jsonb_build_object('ok',false,'reason','purchase_not_payable'); end if;
  if p_currency_code<>v_bill.currency_code or p_payment_date<v_bill.purchase_date then return jsonb_build_object('ok',false,'reason','invalid_payment'); end if;
  if round(p_amount_minor::numeric*p_fx_rate_numerator/p_fx_rate_denominator)::bigint<>p_base_amount_minor then
    return jsonb_build_object('ok',false,'reason','fx_conversion_mismatch'); end if;
  if p_currency_code=v_bill.base_currency_code and (p_fx_rate_numerator<>p_fx_rate_denominator or p_base_amount_minor<>p_amount_minor) then
    return jsonb_build_object('ok',false,'reason','invalid_fx_rate'); end if;
  v_remaining:=v_bill.total_minor-v_bill.amount_paid_minor;
  if p_amount_minor>v_remaining then return jsonb_build_object('ok',false,'reason','overpayment','remaining_minor',v_remaining); end if;
  v_carrying:=case when p_amount_minor=v_remaining then v_bill.base_outstanding_minor
    else round(p_amount_minor::numeric*v_bill.base_outstanding_minor/v_remaining)::bigint end;
  v_new_paid:=v_bill.amount_paid_minor+p_amount_minor;
  v_new_base_paid:=v_bill.base_amount_paid_minor+p_base_amount_minor;
  insert into global.purchase_bill_payments(workspace_id,purchase_bill_id,amount_minor,currency_code,base_amount_minor,
    base_liability_settled_minor,fx_rate_numerator,fx_rate_denominator,fx_rate_date,fx_rate_source,payment_date,method,reference,idempotency_key,recorded_by)
  values(p_workspace_id,p_purchase_bill_id,p_amount_minor,p_currency_code,p_base_amount_minor,v_carrying,
    p_fx_rate_numerator,p_fx_rate_denominator,p_fx_rate_date,btrim(p_fx_rate_source),p_payment_date,nullif(btrim(p_method),''),nullif(btrim(p_reference),''),p_idempotency_key,p_user_id)
  returning * into v_payment;
  update global.purchase_bills set amount_paid_minor=v_new_paid,base_amount_paid_minor=v_new_base_paid,
    base_outstanding_minor=base_outstanding_minor-v_carrying,
    status=case when v_new_paid=total_minor then 'paid' else 'partially_paid' end
  where workspace_id=p_workspace_id and id=p_purchase_bill_id returning * into v_bill;
  return jsonb_build_object('ok',true,'duplicate',false,'payment',to_jsonb(v_payment),'purchase_bill',to_jsonb(v_bill));
end;
$function$;

create or replace function public.global_revalue_purchase_bill(
  p_user_id uuid,p_workspace_id uuid,p_purchase_bill_id uuid,p_revaluation_date date,
  p_fx_rate_numerator bigint,p_fx_rate_denominator bigint,p_fx_rate_source text,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global as $function$
declare v_role text; v_bill global.purchase_bills%rowtype; v_existing global.purchase_fx_revaluations%rowtype;
  v_source_remaining bigint; v_new_base bigint; v_delta bigint; v_reval global.purchase_fx_revaluations%rowtype;
  v_lines jsonb; v_result jsonb;
begin
  if p_user_id is null or p_workspace_id is null or p_purchase_bill_id is null or p_revaluation_date is null
    or p_fx_rate_numerator<=0 or p_fx_rate_denominator<=0 or p_fx_rate_source is null
    or length(btrim(p_fx_rate_source)) not between 1 and 240 or p_idempotency_key is null then
    return jsonb_build_object('ok',false,'reason','invalid_revaluation'); end if;
  select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active';
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','accountant') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':purchase-revalue:'||p_idempotency_key::text,0));
  select * into v_existing from global.purchase_fx_revaluations where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('ok',true,'duplicate',true,'revaluation',to_jsonb(v_existing)); end if;
  select * into v_bill from global.purchase_bills where workspace_id=p_workspace_id and id=p_purchase_bill_id for update;
  if v_bill.id is null or v_bill.status not in ('posted','partially_paid') then return jsonb_build_object('ok',false,'reason','purchase_not_open'); end if;
  if p_revaluation_date<v_bill.purchase_date then return jsonb_build_object('ok',false,'reason','invalid_revaluation_date'); end if;
  v_source_remaining:=v_bill.total_minor-v_bill.amount_paid_minor;
  if v_source_remaining<=0 then return jsonb_build_object('ok',false,'reason','purchase_not_open'); end if;
  if v_bill.currency_code=v_bill.base_currency_code and p_fx_rate_numerator<>p_fx_rate_denominator then return jsonb_build_object('ok',false,'reason','invalid_fx_rate'); end if;
  v_new_base:=round(v_source_remaining::numeric*p_fx_rate_numerator/p_fx_rate_denominator)::bigint;
  if v_new_base<=0 then return jsonb_build_object('ok',false,'reason','invalid_revaluation'); end if;
  v_delta:=v_new_base-v_bill.base_outstanding_minor;
  insert into global.purchase_fx_revaluations(workspace_id,purchase_bill_id,revaluation_date,previous_base_outstanding_minor,
    new_base_outstanding_minor,fx_rate_numerator,fx_rate_denominator,fx_rate_source,idempotency_key,recorded_by)
  values(p_workspace_id,p_purchase_bill_id,p_revaluation_date,v_bill.base_outstanding_minor,v_new_base,
    p_fx_rate_numerator,p_fx_rate_denominator,btrim(p_fx_rate_source),p_idempotency_key,p_user_id) returning * into v_reval;
  if v_delta<>0 then
    if v_delta>0 then
      v_lines:=jsonb_build_array(jsonb_build_object('account_code','6200','debit_minor',v_delta,'credit_minor',0,'description','Unrealized foreign exchange loss'),
        jsonb_build_object('account_code','2000','debit_minor',0,'credit_minor',v_delta,'description','Revalued supplier payable'));
    else
      v_lines:=jsonb_build_array(jsonb_build_object('account_code','2000','debit_minor',-v_delta,'credit_minor',0,'description','Revalued supplier payable'),
        jsonb_build_object('account_code','4200','debit_minor',0,'credit_minor',-v_delta,'description','Unrealized foreign exchange gain'));
    end if;
    v_result:=public.global_post_journal_entry(p_user_id,p_workspace_id,p_revaluation_date,v_bill.base_currency_code,
      'FX revaluation · '||v_bill.supplier_invoice_number,'fx_revaluation',v_reval.id,v_lines,
      md5(p_workspace_id::text||':fx_revaluation:'||v_reval.id::text)::uuid);
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception using errcode='55000',message='FX revaluation journal failed: '||coalesce(v_result->>'reason','unknown'); end if;
  end if;
  update global.purchase_bills set base_outstanding_minor=v_new_base,carrying_fx_rate_numerator=p_fx_rate_numerator,
    carrying_fx_rate_denominator=p_fx_rate_denominator,carrying_fx_rate_date=p_revaluation_date
  where workspace_id=p_workspace_id and id=p_purchase_bill_id returning * into v_bill;
  return jsonb_build_object('ok',true,'duplicate',false,'revaluation',to_jsonb(v_reval),'purchase_bill',to_jsonb(v_bill),'fx_delta_minor',v_delta);
end;
$function$;

revoke all on function public.global_create_purchase_bill(uuid,uuid,text,text,text,text,date,date,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,date,text,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.global_post_purchase_bill(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.global_record_purchase_payment(uuid,uuid,uuid,bigint,text,bigint,bigint,bigint,date,text,date,text,text,uuid) from public,anon,authenticated;
revoke all on function public.global_revalue_purchase_bill(uuid,uuid,uuid,date,bigint,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.global_create_purchase_bill(uuid,uuid,text,text,text,text,date,date,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,date,text,jsonb,text,uuid) to service_role;
grant execute on function public.global_post_purchase_bill(uuid,uuid,uuid) to service_role;
grant execute on function public.global_record_purchase_payment(uuid,uuid,uuid,bigint,text,bigint,bigint,bigint,date,text,date,text,text,uuid) to service_role;
grant execute on function public.global_revalue_purchase_bill(uuid,uuid,uuid,date,bigint,bigint,text,uuid) to service_role;

comment on table global.purchase_bills is 'Global supplier purchase bills with source-currency amounts and immutable FX evidence; ledger postings are in workspace base currency.';
comment on table global.purchase_bill_payments is 'Append-only supplier payments with payment-date FX and realized gain/loss accounting.';
comment on table global.purchase_fx_revaluations is 'Append-only period-end foreign-currency payable revaluations with unrealized FX gain/loss journals.';

commit;
