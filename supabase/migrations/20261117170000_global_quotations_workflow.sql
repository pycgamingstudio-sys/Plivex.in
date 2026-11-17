-- Global quotations are independent commercial documents; they never share invoice status or payment ledgers.
begin;

create table if not exists global.quotations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  client_id uuid,
  quotation_number text not null,
  status text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired','converted')),
  currency_code text not null,
  issue_date date not null,
  valid_until date,
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  notes text,
  converted_invoice_id uuid,
  creation_idempotency_key uuid,
  creation_fingerprint text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, quotation_number),
  unique (id, workspace_id),
  unique (workspace_id, converted_invoice_id),
  unique (workspace_id, creation_idempotency_key)
);

create table if not exists global.quotation_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  quotation_id uuid not null,
  product_id uuid,
  description text not null,
  quantity numeric(20,4) not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint quotation_items_quote_workspace_fk foreign key (quotation_id, workspace_id)
    references global.quotations(id, workspace_id) on delete cascade
);

create index if not exists global_quotations_workspace_created_idx on global.quotations(workspace_id,created_at desc);
create index if not exists global_quotation_items_quote_idx on global.quotation_items(workspace_id,quotation_id,sort_order);

alter table global.quotations enable row level security;
alter table global.quotation_items enable row level security;
revoke all on global.quotations, global.quotation_items from public, anon, authenticated;
grant all on global.quotations, global.quotation_items to service_role;

create or replace function public.global_manage_quotation(
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
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global, public
as $function$
declare
  v_role text;
  v_currency text;
  v_quote global.quotations%rowtype;
  v_item jsonb;
  v_index integer := 0;
  v_description text;
  v_quantity numeric;
  v_unit_price bigint;
  v_discount bigint;
  v_line bigint;
  v_subtotal bigint := 0;
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
  v_invoice_result jsonb;
  v_invoice_id uuid;
  v_conversion_key uuid;
  v_number text;
  v_fingerprint text;
begin
  if p_user_id is null or p_workspace_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_identity');
  end if;
  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if p_action is null or p_action not in ('list','create','status','convert') then
    return jsonb_build_object('ok',false,'reason','unsupported_action');
  end if;

  if p_action='list' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'quotation',to_jsonb(q),
      'client',case when c.id is null then null else jsonb_build_object('id',c.id,'name',c.name,'email',c.email,'phone',c.phone) end,
      'items',coalesce((select jsonb_agg(to_jsonb(qi) order by qi.sort_order) from global.quotation_items qi where qi.workspace_id=q.workspace_id and qi.quotation_id=q.id),'[]'::jsonb)
    ) order by q.created_at desc),'[]'::jsonb)
    into v_result
    from (select * from global.quotations where workspace_id=p_workspace_id order by created_at desc limit 200) q
    left join global.clients c on c.id=q.client_id and c.workspace_id=q.workspace_id;
    return jsonb_build_object('ok',true,'currency_code',(select currency_code from global.workspaces where id=p_workspace_id),'records',v_result);
  end if;

  if p_action='create' then
    if v_role not in ('owner','admin','manager','employee') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
    select currency_code into v_currency from global.workspaces where id=p_workspace_id;
    if v_currency is null or upper(coalesce(p_currency_code,''))<>v_currency then
      return jsonb_build_object('ok',false,'reason','invalid_currency');
    end if;
    if p_idempotency_key is null or p_issue_date is null or (p_valid_until is not null and p_valid_until<p_issue_date)
      or coalesce(length(p_notes),0)>4000 or jsonb_typeof(coalesce(p_items,'null'))<>'array'
      or jsonb_array_length(case when jsonb_typeof(p_items)='array' then p_items else '[]'::jsonb end)<1
      or jsonb_array_length(case when jsonb_typeof(p_items)='array' then p_items else '[]'::jsonb end)>100 then
      return jsonb_build_object('ok',false,'reason','invalid_quotation');
    end if;
    if p_client_id is not null and not exists(select 1 from global.clients where id=p_client_id and workspace_id=p_workspace_id and status='active') then
      return jsonb_build_object('ok',false,'reason','client_not_found');
    end if;
    v_fingerprint:=md5(jsonb_build_object('client_id',p_client_id,'currency_code',v_currency,'issue_date',p_issue_date,'valid_until',p_valid_until,'notes',p_notes,'items',p_items)::text);
    perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':quotation:'||p_idempotency_key::text,0));
    select * into v_quote from global.quotations where workspace_id=p_workspace_id and creation_idempotency_key=p_idempotency_key for update;
    if found then
      if v_quote.creation_fingerprint is distinct from v_fingerprint then return jsonb_build_object('ok',false,'reason','idempotency_conflict'); end if;
      return jsonb_build_object('ok',true,'duplicate',true,'quotation',to_jsonb(v_quote));
    end if;

    for v_item in select value from jsonb_array_elements(p_items) loop
      v_index:=v_index+1;
      begin
        v_description:=btrim(coalesce(v_item->>'description',''));
        v_quantity:=(v_item->>'quantity')::numeric;
        v_unit_price:=(v_item->>'unit_price_minor')::bigint;
        v_discount:=coalesce(nullif(v_item->>'discount_minor','')::bigint,0);
      exception when others then return jsonb_build_object('ok',false,'reason','invalid_item_values','item_index',v_index); end;
      if length(v_description)<1 or length(v_description)>500 or v_quantity<=0 or v_quantity>1000000
        or v_quantity*10000<>trunc(v_quantity*10000) or v_quantity is null or v_unit_price is null or v_discount is null or v_unit_price<0 or v_unit_price>9000000000000000 then
        return jsonb_build_object('ok',false,'reason','invalid_item_values','item_index',v_index);
      end if;
      v_line:=round(v_quantity*v_unit_price)::bigint;
      if v_discount<0 or v_discount>v_line or v_line>9000000000000000 then
        return jsonb_build_object('ok',false,'reason','invalid_item_discount','item_index',v_index);
      end if;
      v_subtotal:=v_subtotal+v_line; v_total:=v_total+v_line-v_discount;
      if v_subtotal>9000000000000000 or v_total>9000000000000000 then
        return jsonb_build_object('ok',false,'reason','quotation_total_limit');
      end if;
      v_items:=v_items||jsonb_build_array(jsonb_build_object(
        'description',v_description,'quantity',v_quantity,'unit_price_minor',v_unit_price,
        'discount_minor',v_discount,'line_total_minor',v_line-v_discount,'sort_order',v_index-1
      ));
    end loop;
    v_number:='QUO-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    insert into global.quotations(workspace_id,client_id,quotation_number,currency_code,issue_date,valid_until,subtotal_minor,discount_minor,total_minor,notes,created_by,creation_idempotency_key,creation_fingerprint)
    values(p_workspace_id,p_client_id,v_number,v_currency,p_issue_date,p_valid_until,v_subtotal,v_subtotal-v_total,v_total,nullif(btrim(p_notes),''),p_user_id,p_idempotency_key,v_fingerprint)
    returning * into v_quote;
    for v_item in select value from jsonb_array_elements(v_items) loop
      insert into global.quotation_items(workspace_id,quotation_id,description,quantity,unit_price_minor,discount_minor,line_total_minor,sort_order)
      values(p_workspace_id,v_quote.id,v_item->>'description',(v_item->>'quantity')::numeric,(v_item->>'unit_price_minor')::bigint,(v_item->>'discount_minor')::bigint,(v_item->>'line_total_minor')::bigint,(v_item->>'sort_order')::integer);
    end loop;
    return jsonb_build_object('ok',true,'quotation',to_jsonb(v_quote),'items',v_items);
  end if;

  if p_quotation_id is null then return jsonb_build_object('ok',false,'reason','quotation_not_found'); end if;
  select * into v_quote from global.quotations where id=p_quotation_id and workspace_id=p_workspace_id for update;
  if v_quote.id is null then return jsonb_build_object('ok',false,'reason','quotation_not_found'); end if;

  if p_action='status' then
    if v_role not in ('owner','admin','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
    if v_quote.status in ('converted','rejected','expired') then return jsonb_build_object('ok',false,'reason','quotation_closed'); end if;
    if p_status is null or p_status not in ('sent','accepted','rejected','expired') then return jsonb_build_object('ok',false,'reason','invalid_status'); end if;
    if (p_status='sent' and v_quote.status<>'draft') or (p_status='accepted' and v_quote.status not in ('sent','draft')) then
      return jsonb_build_object('ok',false,'reason','invalid_transition');
    end if;
    update global.quotations set status=p_status,updated_at=now() where id=v_quote.id and workspace_id=p_workspace_id returning * into v_quote;
    return jsonb_build_object('ok',true,'quotation',to_jsonb(v_quote));
  end if;

  if p_action='convert' then
    if v_role not in ('owner','admin','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
    if v_quote.status='converted' and v_quote.converted_invoice_id is not null then
      select to_jsonb(i) into v_result from global.invoices i where i.id=v_quote.converted_invoice_id and i.workspace_id=p_workspace_id;
      return jsonb_build_object('ok',true,'duplicate',true,'invoice',v_result);
    end if;
    if v_quote.status<>'accepted' then return jsonb_build_object('ok',false,'reason','quotation_not_accepted'); end if;
    v_conversion_key:=gen_random_uuid();
    select coalesce(jsonb_agg(jsonb_build_object(
      'description',qi.description,'quantity',qi.quantity,'unit_price_minor',qi.unit_price_minor,
      'discount_minor',qi.discount_minor,'product_id',null
    ) order by qi.sort_order),'[]'::jsonb) into v_items
    from global.quotation_items qi where qi.workspace_id=p_workspace_id and qi.quotation_id=v_quote.id;
    v_invoice_result:=public.global_create_invoice_draft(
      p_user_id,p_workspace_id,v_quote.client_id,v_quote.currency_code,current_date,null,
      'Converted from quotation '||v_quote.quotation_number,v_items,v_conversion_key
    );
    if coalesce((v_invoice_result->>'ok')::boolean,false) is not true then
      return jsonb_build_object('ok',false,'reason','invoice_conversion_failed','detail',v_invoice_result->>'reason');
    end if;
    v_invoice_id:=nullif(v_invoice_result->'invoice'->>'id','')::uuid;
    update global.quotations set status='converted',converted_invoice_id=v_invoice_id,updated_at=now()
    where id=v_quote.id and workspace_id=p_workspace_id returning * into v_quote;
    return jsonb_build_object('ok',true,'quotation',to_jsonb(v_quote),'invoice',v_invoice_result->'invoice');
  end if;
  return jsonb_build_object('ok',false,'reason','unsupported_action');
end;
$function$;

revoke all on function public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid) to service_role;

commit;
