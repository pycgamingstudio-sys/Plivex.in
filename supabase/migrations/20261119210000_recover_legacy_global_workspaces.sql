-- Recover pre-isolation Global workspaces without discarding their canonical public records.
-- The public source rows remain untouched; this migration copies them into the
-- isolated Global schema using stable IDs and an idempotent workspace mapping.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists private.legacy_global_import_transactions (
  transaction_id bigint primary key,
  created_at timestamptz not null default now()
);
revoke all on table private.legacy_global_import_transactions from public, anon, authenticated, service_role;

create or replace function private.is_legacy_global_import()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $function$
  select exists (
    select 1 from private.legacy_global_import_transactions
    where transaction_id = txid_current()
  );
$function$;
revoke all on function private.is_legacy_global_import() from public, anon, authenticated, service_role;

-- Historical amounts may use a currency different from today's workspace base
-- currency. Preserve those original currencies and do not fabricate journal
-- entries or exchange rates while importing legacy source records.
create or replace function global.accounting_after_expense()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, global, private
as $function$
declare
  v_account_code text;
  v_result jsonb;
begin
  if private.is_legacy_global_import() then return new; end if;

  v_account_code:=case when lower(coalesce(new.payment_method,'')) like '%cash%' then '1000' else '1010' end;
  v_result:=public.global_post_journal_entry(
    new.created_by,new.workspace_id,new.expense_date,new.currency_code,
    'Expense · '||new.category,'expense',new.id,
    jsonb_build_array(
      jsonb_build_object('account_code','6000','debit_minor',new.amount_minor,'credit_minor',0,'description',left(new.category,300)),
      jsonb_build_object('account_code',v_account_code,'debit_minor',0,'credit_minor',new.amount_minor,'description','Expense paid')
    ),
    md5(new.workspace_id::text||':expense:'||new.id::text)::uuid
  );
  if not coalesce((v_result->>'ok')::boolean,false) then
    raise exception using errcode='55000',message='Expense accounting failed: '||coalesce(v_result->>'reason','unknown');
  end if;
  return new;
end;
$function$;

create or replace function global.accounting_after_invoice_issued()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, global, private
as $function$
declare
  v_lines jsonb;
  v_result jsonb;
  v_revenue bigint;
begin
  if private.is_legacy_global_import() then return new; end if;

  if new.total_minor>0 and (
    (tg_op='INSERT' and new.status='issued')
    or (tg_op='UPDATE' and old.status='draft' and new.status='issued')
  ) then
    v_revenue:=new.total_minor-new.tax_minor;
    v_lines:=jsonb_build_array(jsonb_build_object(
      'account_code','1100','debit_minor',new.total_minor,'credit_minor',0,'description','Accounts receivable'
    ));
    if v_revenue>0 then
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
        'account_code','4000','debit_minor',0,'credit_minor',v_revenue,'description','Invoice revenue'
      ));
    end if;
    if new.tax_minor>0 then
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
        'account_code','2100','debit_minor',0,'credit_minor',new.tax_minor,'description','Tax payable'
      ));
    end if;
    v_result:=public.global_post_journal_entry(
      new.created_by,new.workspace_id,new.issue_date,new.currency_code,
      'Invoice issued · '||new.invoice_number,'invoice_issued',new.id,v_lines,
      md5(new.workspace_id::text||':invoice_issued:'||new.id::text)::uuid
    );
    if not coalesce((v_result->>'ok')::boolean,false) then
      raise exception using errcode='55000',message='Invoice issuance accounting failed: '||coalesce(v_result->>'reason','unknown');
    end if;
  end if;
  return new;
end;
$function$;

-- Give every legacy non-India workspace a stable Global UUID. Existing mappings
-- are retained; no source workspace IDs or business records are rewritten.
update public.workspace_settings
set legacy_global_workspace_id = gen_random_uuid(), updated_at = now()
where country_code <> 'IN' and legacy_global_workspace_id is null;

create temporary table _legacy_global_workspace_map on commit drop as
select
  ws.workspace_id as legacy_workspace_id,
  ws.legacy_global_workspace_id as global_workspace_id,
  ws.created_by as owner_id,
  ws.country_code,
  ws.locale_code,
  ws.currency_code,
  coalesce(nullif(left(btrim(bp.name),160),''), nullif(left(btrim(p.full_name),160),''), left(coalesce(nullif(split_part(p.email,'@',1),''),'Plivex Workspace'),160)) as workspace_name,
  p.email,
  coalesce(p.full_name,'') as full_name,
  p.profile_picture
from public.workspace_settings ws
join public.profiles p on p.id = ws.created_by
left join public.business_profile bp on bp.workspace_id = ws.workspace_id
where ws.country_code <> 'IN';

do $preflight$
begin
  if exists (
    select 1 from _legacy_global_workspace_map
    where global_workspace_id is null or owner_id is null
      or country_code !~ '^[A-Z]{2}$' or currency_code !~ '^[A-Z]{3}$'
      or locale_code is null or length(locale_code) not between 2 and 16
  ) then
    raise exception 'Legacy Global recovery stopped: incomplete or invalid workspace identity';
  end if;

  if exists (
    select 1 from _legacy_global_workspace_map m
    left join public.workspace_members pm
      on pm.workspace_id=m.legacy_workspace_id and pm.user_id=m.owner_id
       and pm.role='admin' and pm.status='active'
    where pm.id is null
  ) then
    raise exception 'Legacy Global recovery stopped: an owner has no verified active canonical membership';
  end if;

  if exists (
    select 1 from _legacy_global_workspace_map m
    join global.workspaces w on w.id=m.global_workspace_id
    where w.created_by <> m.owner_id or w.country_code <> m.country_code
       or w.locale_code <> m.locale_code or w.currency_code <> m.currency_code
  ) then
    raise exception 'Legacy Global recovery stopped: existing Global workspace mapping conflicts with canonical identity';
  end if;

  if exists (
    select 1 from _legacy_global_workspace_map m
    join global.user_profiles p on p.user_id=m.owner_id
    where p.default_workspace_id is not null
      and p.default_workspace_id <> m.global_workspace_id
  ) then
    raise exception 'Legacy Global recovery stopped: owner already has a different default Global workspace';
  end if;

  if exists (
    select 1 from public.stock s
    join _legacy_global_workspace_map m on m.legacy_workspace_id=s.workspace_id
    where s.quantity < 0 or s.price < 0 or s.purchase_cost < 0
       or length(btrim(s.name)) not between 1 and 200
  ) or exists (
    select 1 from public.stock s
    join _legacy_global_workspace_map m on m.legacy_workspace_id=s.workspace_id
    where s.sku is not null and s.sku <> ''
    group by m.global_workspace_id,s.sku having count(*) > 1
  ) then
    raise exception 'Legacy Global recovery stopped: invalid or duplicate stock records require review';
  end if;

  if exists (
    select 1 from public.invoices i
    join _legacy_global_workspace_map m on m.legacy_workspace_id=i.workspace_id
    where length(btrim(i.number)) not between 1 and 64
       or coalesce(i.subtotal,0)<0 or coalesce(i.tax_value,0)<0
       or coalesce(i.total,0)<0 or coalesce(i.tax_value,0)>coalesce(i.total,0)
       or coalesce(i.currency,'') !~ '^[A-Za-z]{3}$'
  ) then
    raise exception 'Legacy Global recovery stopped: invoice amounts, number or currency require review';
  end if;

  if exists (
    select 1 from public.invoice_items ii
    join public.invoices i on i.id=ii.invoice_id
    join _legacy_global_workspace_map m on m.legacy_workspace_id=i.workspace_id
    where coalesce(ii.quantity,0)<=0 or coalesce(ii.rate,0)<0
       or coalesce(ii.gst_rate,0)<0 or coalesce(ii.gst_rate,100)>100
       or length(btrim(ii.description)) not between 1 and 500
  ) then
    raise exception 'Legacy Global recovery stopped: invoice line items require review';
  end if;

  if exists (
    select 1 from public.expenses e
    join _legacy_global_workspace_map m on m.legacy_workspace_id=e.workspace_id
    where coalesce(e.amount,0)<=0 or length(btrim(coalesce(e.category,''))) not between 1 and 100
       or (e.currency_code is not null and e.currency_code !~ '^[A-Z]{3}$')
  ) then
    raise exception 'Legacy Global recovery stopped: expense amount, category or currency requires review';
  end if;

  if exists (
    select 1 from public.quotations q
    join _legacy_global_workspace_map m on m.legacy_workspace_id=q.workspace_id
    where length(btrim(q.number)) not between 1 and 64
       or jsonb_typeof(q.items) <> 'array'
       or coalesce(q.total,0)<0
       or (q.currency_code is not null and q.currency_code !~ '^[A-Z]{3}$')
  ) then
    raise exception 'Legacy Global recovery stopped: quotation header requires review';
  end if;

  if exists (
    select 1 from public.quotations q
    join _legacy_global_workspace_map m on m.legacy_workspace_id=q.workspace_id
    cross join lateral jsonb_array_elements(q.items) item
    where coalesce(nullif(item->>'quantity','')::numeric,0)<=0
       or coalesce(nullif(item->>'rate','')::numeric,-1)<0
       or length(btrim(coalesce(item->>'description',''))) not between 1 and 500
  ) then
    raise exception 'Legacy Global recovery stopped: quotation line items require review';
  end if;

  if exists (
    select 1 from public.stock_movements sm
    join _legacy_global_workspace_map m on m.legacy_workspace_id=sm.workspace_id
    where sm.quantity_delta=0 or sm.created_by is null
  ) then
    raise exception 'Legacy Global recovery stopped: stock movement history requires review';
  end if;

  if exists (
    select 1 from _legacy_global_workspace_map m
    join global.workspace_members gm on gm.workspace_id=m.global_workspace_id
    where gm.user_id=m.owner_id and (gm.role <> 'owner' or gm.status <> 'active')
  ) then
    raise exception 'Legacy Global recovery stopped: existing owner membership is not active';
  end if;
end
$preflight$;

insert into global.workspaces(id,name,country_code,locale_code,currency_code,created_by)
select global_workspace_id,workspace_name,country_code,locale_code,currency_code,owner_id
from _legacy_global_workspace_map
on conflict (id) do nothing;

insert into global.user_profiles(user_id,email,full_name,avatar_url,default_workspace_id)
select owner_id,email,full_name,profile_picture,global_workspace_id
from _legacy_global_workspace_map
on conflict (user_id) do update
set email=coalesce(global.user_profiles.email,excluded.email),
    full_name=case when global.user_profiles.full_name='' then excluded.full_name else global.user_profiles.full_name end,
    avatar_url=coalesce(global.user_profiles.avatar_url,excluded.avatar_url),
    default_workspace_id=coalesce(global.user_profiles.default_workspace_id,excluded.default_workspace_id),
    updated_at=now();

insert into global.workspace_members(workspace_id,user_id,role,status)
select global_workspace_id,owner_id,'owner','active'
from _legacy_global_workspace_map
on conflict (workspace_id,user_id) do nothing;

insert into global.business_profiles(
  workspace_id,legal_name,display_name,email,phone,address,tax_registration_number,
  tax_registration_type,tax_registration_status,tax_jurisdiction_code,country_code,
  locale_code,currency_code,tax_registration_effective_from
)
select
  m.global_workspace_id,
  coalesce(nullif(bp.name,''),m.workspace_name),
  coalesce(nullif(bp.name,''),m.workspace_name),
  bp.email,bp.phone,bp.address,bp.tax_registration_number,bp.tax_registration_type,
  coalesce(bp.tax_registration_status,'unregistered'),bp.tax_jurisdiction_code,
  m.country_code,m.locale_code,m.currency_code,bp.tax_registration_effective_from
from _legacy_global_workspace_map m
left join public.business_profile bp on bp.workspace_id=m.legacy_workspace_id
on conflict (workspace_id) do nothing;

insert into global.warehouses(id,workspace_id,code,name,address,is_default,is_active,created_by,created_at,updated_at)
select
  wh.id,m.global_workspace_id,left(wh.code,32),left(wh.name,160),
  case when wh.address is null then '{}'::jsonb else jsonb_build_object('legacy_address',wh.address) end,
  wh.is_default,wh.is_active,m.owner_id,wh.created_at,wh.updated_at
from public.warehouses wh
join _legacy_global_workspace_map m on m.legacy_workspace_id=wh.workspace_id
on conflict (id) do nothing;

insert into global.clients(id,workspace_id,name,email,phone,tax_registration_number,billing_address,shipping_address,notes,created_by,created_at,updated_at)
select
  c.id,m.global_workspace_id,
  coalesce(nullif(left(btrim(c.name),200),''),nullif(left(btrim(c.company),200),''),'Client'),
  c.email,c.phone,c.gstin,
  case when c.address is null then '{}'::jsonb else jsonb_build_object('legacy_address',c.address) end,
  '{}'::jsonb,
  case when nullif(c.company,'') is null then null else 'Company: '||c.company end,
  m.owner_id,c.created_at,c.updated_at
from public.clients c
join _legacy_global_workspace_map m on m.legacy_workspace_id=c.workspace_id
on conflict (id) do nothing;

insert into global.products(id,workspace_id,name,sku,description,unit,sale_price_minor,purchase_cost_minor,currency_code,tax_code,is_active,created_by,created_at,updated_at,barcode,variant_of,variant_label)
select
  s.id,m.global_workspace_id,left(btrim(s.name),200),nullif(s.sku,''),
  null,nullif(s.unit,''),round(s.price*100)::bigint,round(s.purchase_cost*100)::bigint,
  coalesce(nullif(upper(s.currency_code),''),m.currency_code),null,true,m.owner_id,
  s.created_at,s.updated_at,s.barcode,
  case when exists(select 1 from public.stock parent where parent.id=s.variant_of and parent.workspace_id=s.workspace_id) then s.variant_of else null end,
  s.variant_label
from public.stock s
join _legacy_global_workspace_map m on m.legacy_workspace_id=s.workspace_id
on conflict (id) do nothing;

insert into global.stock_levels(workspace_id,product_id,quantity,reorder_level)
select m.global_workspace_id,s.id,s.quantity,s.low_stock
from public.stock s
join _legacy_global_workspace_map m on m.legacy_workspace_id=s.workspace_id
on conflict (workspace_id,product_id) do update
set quantity=excluded.quantity,reorder_level=excluded.reorder_level,updated_at=now();

insert into global.stock_movements(id,workspace_id,product_id,movement_type,quantity_delta,reference_type,reference_id,notes,created_by,created_at,idempotency_key)
select
  sm.id,m.global_workspace_id,sm.stock_id,
  case when sm.movement_type in ('opening','receipt','sale','return','adjustment') then sm.movement_type else 'adjustment' end,
  sm.quantity_delta,sm.reference_type,sm.reference_id,sm.notes,sm.created_by,sm.created_at,sm.idempotency_key
from public.stock_movements sm
join _legacy_global_workspace_map m on m.legacy_workspace_id=sm.workspace_id
on conflict (id) do nothing;

insert into global.invoices(
  id,workspace_id,client_id,invoice_number,status,currency_code,issue_date,due_date,
  subtotal_minor,discount_minor,tax_minor,total_minor,amount_paid_minor,notes,
  invoice_snapshot,created_by,created_at,updated_at
)
select
  i.id,m.global_workspace_id,
  case when gc.id is not null then i.client_id else null end,
  left(i.number,64),'draft',upper(coalesce(nullif(i.currency,''),m.currency_code)),
  i.issue_date,i.due_date,
  round(greatest(coalesce(i.subtotal,0),0)*100)::bigint,
  least(round(greatest(coalesce(i.subtotal,0),0)*100)::bigint,
        round(greatest(coalesce(i.subtotal+i.tax_value-i.total,0),0)*100)::bigint),
  round(greatest(coalesce(i.tax_value,0),0)*100)::bigint,
  round(greatest(coalesce(i.total,0),0)*100)::bigint,
  case when lower(coalesce(i.status,''))='paid' then round(greatest(coalesce(i.total,0),0)*100)::bigint else 0 end,
  concat_ws(E'\n',nullif(i.notes,''),nullif(i.terms,'')),
  coalesce(i.invoice_snapshot,'{}'::jsonb)||jsonb_build_object('_legacy_public_invoice',to_jsonb(i)),
  coalesce(i.created_by,m.owner_id),i.created_at,i.updated_at
from public.invoices i
join _legacy_global_workspace_map m on m.legacy_workspace_id=i.workspace_id
left join global.clients gc on gc.workspace_id=m.global_workspace_id and gc.id=i.client_id
on conflict (id) do nothing;

insert into global.invoice_items(id,workspace_id,invoice_id,product_id,description,quantity,unit_price_minor,discount_minor,tax_rate_bps,tax_minor,line_total_minor,sort_order,created_at)
select
  ii.id,m.global_workspace_id,ii.invoice_id,null,left(btrim(ii.description),500),ii.quantity,
  round(ii.rate*100)::bigint,0,least(10000,greatest(0,round(coalesce(ii.gst_rate,0)*100)::integer)),
  round(ii.quantity*ii.rate*coalesce(ii.gst_rate,0))::bigint,
  round(ii.quantity*ii.rate*(1+coalesce(ii.gst_rate,0)/100)*100)::bigint,
  row_number() over(partition by ii.invoice_id order by ii.created_at,ii.id)::integer,ii.created_at
from public.invoice_items ii
join public.invoices i on i.id=ii.invoice_id
join _legacy_global_workspace_map m on m.legacy_workspace_id=i.workspace_id
on conflict (id) do nothing;

-- Restore the recorded invoice state only after its lines are present. The
-- private transaction marker suppresses automatic historical journal posting.
update global.invoices gi
set status=case
  when lower(coalesce(pi.status,''))='paid' then 'paid'
  when lower(coalesce(pi.status,''))='overdue' then 'overdue'
  when lower(coalesce(pi.status,'')) in ('cancelled','canceled') then 'cancelled'
  when lower(coalesce(pi.status,''))='partially_paid' then 'partially_paid'
  when coalesce(pi.is_draft,false) then 'draft'
  else 'issued'
end
from public.invoices pi
join _legacy_global_workspace_map m on m.legacy_workspace_id=pi.workspace_id
where gi.id=pi.id and gi.workspace_id=m.global_workspace_id and gi.status='draft';

insert into global.expenses(
  id,workspace_id,category,vendor,amount_minor,currency_code,expense_date,payment_method,
  reference,notes,created_by,created_at,updated_at,transaction_amount_minor,transaction_currency_code
)
select
  e.id,m.global_workspace_id,left(coalesce(nullif(btrim(e.category),''),'Uncategorized'),100),
  e.vendor,round(e.amount*100)::bigint,
  upper(coalesce(nullif(e.currency_code,''),m.currency_code)),
  coalesce(e.date,e.created_at::date),e.method,null,e.notes,m.owner_id,e.created_at,e.updated_at,
  round(e.amount*100)::bigint,upper(coalesce(nullif(e.currency_code,''),m.currency_code))
from public.expenses e
join _legacy_global_workspace_map m on m.legacy_workspace_id=e.workspace_id
on conflict (id) do nothing;

insert into global.quotations(
  id,workspace_id,client_id,quotation_number,status,currency_code,issue_date,
  subtotal_minor,discount_minor,total_minor,notes,created_by,created_at,updated_at
)
select
  q.id,m.global_workspace_id,
  case when gc.id is not null then q.client_id else null end,
  left(q.number,64),
  case when lower(coalesce(q.status,'')) in ('sent','accepted','rejected','expired','converted') then lower(q.status) else 'draft' end,
  upper(coalesce(nullif(q.currency_code,''),m.currency_code)),
  coalesce(q.date,q.created_at::date),
  round(coalesce((select sum((item->>'quantity')::numeric*(item->>'rate')::numeric) from jsonb_array_elements(q.items) item),0)*100)::bigint,
  0,round(greatest(coalesce(q.total,0),0)*100)::bigint,
  'Legacy quotation import; source tax rate: '||coalesce(q.tax_rate::text,'0')||'%. Original source row remains in public.quotations.',
  m.owner_id,q.created_at,q.updated_at
from public.quotations q
join _legacy_global_workspace_map m on m.legacy_workspace_id=q.workspace_id
left join global.clients gc on gc.workspace_id=m.global_workspace_id and gc.id=q.client_id
on conflict (id) do nothing;

insert into global.quotation_items(id,workspace_id,quotation_id,product_id,description,quantity,unit_price_minor,discount_minor,line_total_minor,sort_order,created_at)
select
  md5(m.global_workspace_id::text||':legacy-quotation-item:'||q.id::text||':'||
      coalesce(item->>'id',ordinality::text))::uuid,
  m.global_workspace_id,q.id,null,left(btrim(item->>'description'),500),
  (item->>'quantity')::numeric,round((item->>'rate')::numeric*100)::bigint,0,
  round((item->>'quantity')::numeric*(item->>'rate')::numeric*
        (1+coalesce(nullif(q.tax_rate::text,'')::numeric,0)/100)*100)::bigint,
  ordinality::integer,q.created_at
from public.quotations q
join _legacy_global_workspace_map m on m.legacy_workspace_id=q.workspace_id
cross join lateral jsonb_array_elements(q.items) with ordinality as quote_items(item,ordinality)
on conflict (id) do nothing;

-- Fail atomically if any source record was not represented in Global.
do $verify$
begin
  if exists (
    select 1 from public.clients c join _legacy_global_workspace_map m on m.legacy_workspace_id=c.workspace_id
    where not exists(select 1 from global.clients g where g.workspace_id=m.global_workspace_id and g.id=c.id)
  ) or exists (
    select 1 from public.stock s join _legacy_global_workspace_map m on m.legacy_workspace_id=s.workspace_id
    where not exists(select 1 from global.products g where g.workspace_id=m.global_workspace_id and g.id=s.id)
       or not exists(select 1 from global.stock_levels l where l.workspace_id=m.global_workspace_id and l.product_id=s.id)
  ) or exists (
    select 1 from public.stock_movements sm join _legacy_global_workspace_map m on m.legacy_workspace_id=sm.workspace_id
    where not exists(select 1 from global.stock_movements g where g.workspace_id=m.global_workspace_id and g.id=sm.id)
  ) or exists (
    select 1 from public.invoices i join _legacy_global_workspace_map m on m.legacy_workspace_id=i.workspace_id
    where not exists(select 1 from global.invoices g where g.workspace_id=m.global_workspace_id and g.id=i.id)
  ) or exists (
    select 1 from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id
    join _legacy_global_workspace_map m on m.legacy_workspace_id=i.workspace_id
    where not exists(select 1 from global.invoice_items g where g.workspace_id=m.global_workspace_id and g.id=ii.id)
  ) or exists (
    select 1 from public.expenses e join _legacy_global_workspace_map m on m.legacy_workspace_id=e.workspace_id
    where not exists(select 1 from global.expenses g where g.workspace_id=m.global_workspace_id and g.id=e.id)
  ) or exists (
    select 1 from public.quotations q join _legacy_global_workspace_map m on m.legacy_workspace_id=q.workspace_id
    where not exists(select 1 from global.quotations g where g.workspace_id=m.global_workspace_id and g.id=q.id)
  ) then
    raise exception 'Legacy Global recovery verification failed; transaction rolled back';
  end if;

  if exists (
    select 1 from _legacy_global_workspace_map m
    where not exists(select 1 from global.workspace_members gm
      where gm.workspace_id=m.global_workspace_id and gm.user_id=m.owner_id and gm.role='owner' and gm.status='active')
      or not exists(select 1 from global.user_profiles gp
      where gp.user_id=m.owner_id and gp.default_workspace_id=m.global_workspace_id)
  ) then
    raise exception 'Legacy Global recovery identity verification failed; transaction rolled back';
  end if;
end
$verify$;

delete from private.legacy_global_import_transactions where transaction_id=txid_current();

commit;
