-- Global draft invoice creation and idempotent external-payment ledger.
-- Drafts intentionally carry no tax calculation and cannot be treated as issued tax invoices.
begin;

alter table global.invoices
  add column if not exists creation_idempotency_key uuid;

create unique index if not exists global_invoices_creation_idempotency_idx
  on global.invoices(workspace_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

alter table global.invoice_payments
  add column if not exists idempotency_key uuid;

create unique index if not exists global_invoice_payments_idempotency_idx
  on global.invoice_payments(workspace_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.global_create_invoice_draft(
  p_user_id uuid,
  p_workspace_id uuid,
  p_client_id uuid,
  p_currency_code text,
  p_issue_date date,
  p_due_date date,
  p_notes text,
  p_items jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_currency text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_subtotal bigint := 0;
  v_discount bigint := 0;
  v_total bigint := 0;
  v_line_subtotal bigint;
  v_line_discount bigint;
  v_line_total bigint;
  v_item jsonb;
  v_product_id uuid;
  v_description text;
  v_quantity numeric;
  v_unit_price bigint;
  v_index integer := 0;
  v_invoice jsonb;
  v_items jsonb := '[]'::jsonb;
  v_existing global.invoices%rowtype;
  v_fingerprint text;
begin
  if p_user_id is null or p_workspace_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_identity');
  end if;
  select role into v_role
  from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager','employee') then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  select currency_code into v_currency from global.workspaces where id=p_workspace_id;
  if v_currency is null then return jsonb_build_object('ok',false,'reason','workspace_not_found'); end if;
  if upper(coalesce(p_currency_code,'')) <> v_currency then
    return jsonb_build_object('ok',false,'reason','invalid_currency');
  end if;
  if p_issue_date is null or (p_due_date is not null and p_due_date < p_issue_date) then
    return jsonb_build_object('ok',false,'reason','invalid_dates');
  end if;
  if p_idempotency_key is null then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  if p_notes is not null and length(p_notes)>4000 then
    return jsonb_build_object('ok',false,'reason','invalid_notes');
  end if;
  if jsonb_typeof(coalesce(p_items,'null')) <> 'array'
     or jsonb_array_length(case when jsonb_typeof(p_items)='array' then p_items else '[]'::jsonb end)<1
     or jsonb_array_length(case when jsonb_typeof(p_items)='array' then p_items else '[]'::jsonb end)>100 then
    return jsonb_build_object('ok',false,'reason','invalid_items');
  end if;
  if p_client_id is not null and not exists(
    select 1 from global.clients where id=p_client_id and workspace_id=p_workspace_id and status='active'
  ) then
    return jsonb_build_object('ok',false,'reason','client_not_found');
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'client_id',p_client_id,'currency_code',v_currency,'issue_date',p_issue_date,
    'due_date',p_due_date,'notes',p_notes,'items',p_items
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from global.invoices
  where workspace_id=p_workspace_id and creation_idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.invoice_snapshot->>'draft_request_fingerprint' IS DISTINCT FROM v_fingerprint then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict');
    end if;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order),'[]'::jsonb) into v_items
    from global.invoice_items t where t.workspace_id=p_workspace_id and t.invoice_id=v_existing.id;
    return jsonb_build_object('ok',true,'duplicate',true,'invoice',to_jsonb(v_existing),'items',v_items);
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_description := btrim(coalesce(v_item->>'description',''));
    begin
      v_quantity := (v_item->>'quantity')::numeric;
      v_unit_price := (v_item->>'unit_price_minor')::bigint;
      v_line_discount := coalesce(nullif(v_item->>'discount_minor','')::bigint,0);
      v_product_id := nullif(v_item->>'product_id','')::uuid;
    exception when others then
      return jsonb_build_object('ok',false,'reason','invalid_item_values','item_index',v_index);
    end;
    if length(v_description)<1 or length(v_description)>500
      or v_quantity is null or v_quantity<=0 or v_quantity>1000000
      or v_quantity*10000 <> trunc(v_quantity*10000)
      or v_unit_price is null or v_unit_price<0 or v_unit_price>9000000000000000 then
      return jsonb_build_object('ok',false,'reason','invalid_item_values','item_index',v_index);
    end if;
    if v_product_id is not null and not exists(
      select 1 from global.products where id=v_product_id and workspace_id=p_workspace_id and is_active=true
    ) then
      return jsonb_build_object('ok',false,'reason','product_not_found','item_index',v_index);
    end if;
    if v_quantity*v_unit_price > 9000000000000000 then
      return jsonb_build_object('ok',false,'reason','invalid_item_values','item_index',v_index);
    end if;
    v_line_subtotal := round(v_quantity*v_unit_price)::bigint;
    if v_line_discount<0 or v_line_discount>v_line_subtotal then
      return jsonb_build_object('ok',false,'reason','invalid_item_discount','item_index',v_index);
    end if;
    v_line_total := v_line_subtotal-v_line_discount;
    v_subtotal := v_subtotal+v_line_subtotal;
    v_discount := v_discount+v_line_discount;
    if v_subtotal > 9000000000000000 or v_discount > v_subtotal then
      return jsonb_build_object('ok',false,'reason','invoice_total_limit');
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id',v_product_id,
      'description',v_description,
      'quantity',v_quantity,
      'unit_price_minor',v_unit_price,
      'discount_minor',v_line_discount,
      'tax_rate_bps',0,
      'tax_minor',0,
      'line_total_minor',v_line_total,
      'sort_order',v_index-1
    ));
  end loop;

  v_total := v_subtotal-v_discount;
  v_invoice_number := 'DRAFT-' || to_char(current_date,'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into global.invoices(
    workspace_id,client_id,invoice_number,status,currency_code,issue_date,due_date,
    subtotal_minor,discount_minor,tax_minor,total_minor,amount_paid_minor,notes,invoice_snapshot,created_by,creation_idempotency_key
  ) values (
    p_workspace_id,p_client_id,v_invoice_number,'draft',v_currency,p_issue_date,p_due_date,
    v_subtotal,v_discount,0,v_total,0,p_notes,
    jsonb_build_object('tax_status','not_calculated','document_status','draft_only','draft_request_fingerprint',v_fingerprint),p_user_id,p_idempotency_key
  ) returning id into v_invoice_id;

  for v_item in select value from jsonb_array_elements(v_items) loop
    insert into global.invoice_items(
      workspace_id,invoice_id,product_id,description,quantity,unit_price_minor,
      discount_minor,tax_rate_bps,tax_minor,line_total_minor,sort_order
    ) values (
      p_workspace_id,v_invoice_id,nullif(v_item->>'product_id','')::uuid,
      v_item->>'description',(v_item->>'quantity')::numeric,
      (v_item->>'unit_price_minor')::bigint,(v_item->>'discount_minor')::bigint,
      0,0,(v_item->>'line_total_minor')::bigint,(v_item->>'sort_order')::integer
    );
  end loop;

  select to_jsonb(i) into v_invoice from global.invoices i
  where i.id=v_invoice_id and i.workspace_id=p_workspace_id;
  return jsonb_build_object('ok',true,'invoice',v_invoice,'items',v_items);
end;
$function$;

create or replace function public.global_record_invoice_payment(
  p_user_id uuid,
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_amount_minor bigint,
  p_currency_code text,
  p_payment_date date,
  p_method text,
  p_reference text,
  p_notes text,
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
  v_existing global.invoice_payments%rowtype;
  v_payment global.invoice_payments%rowtype;
  v_remaining bigint;
  v_new_paid bigint;
  v_new_status text;
begin
  if p_user_id is null or p_workspace_id is null or p_invoice_id is null or p_idempotency_key is null
    or p_amount_minor is null or p_amount_minor<=0 or p_payment_date is null
    or p_currency_code is null or p_currency_code !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok',false,'reason','invalid_payment');
  end if;
  if coalesce(length(p_method),0)>80 or coalesce(length(p_reference),0)>160 or coalesce(length(p_notes),0)>1000 then
    return jsonb_build_object('ok',false,'reason','invalid_payment');
  end if;
  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager','accountant') then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from global.invoice_payments
  where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.invoice_id<>p_invoice_id or v_existing.amount_minor<>p_amount_minor
      or v_existing.currency_code<>upper(p_currency_code)
      or v_existing.payment_date<>p_payment_date
      or coalesce(v_existing.method,'')<>coalesce(nullif(btrim(p_method),''),'')
      or coalesce(v_existing.reference,'')<>coalesce(nullif(btrim(p_reference),''),'')
      or coalesce(v_existing.notes,'')<>coalesce(nullif(btrim(p_notes),''),'') then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict');
    end if;
    select * into v_invoice from global.invoices where id=v_existing.invoice_id and workspace_id=p_workspace_id;
    return jsonb_build_object('ok',true,'duplicate',true,'payment',to_jsonb(v_existing),'invoice',to_jsonb(v_invoice));
  end if;

  select * into v_invoice from global.invoices
  where id=p_invoice_id and workspace_id=p_workspace_id
  for update;
  if v_invoice.id is null then return jsonb_build_object('ok',false,'reason','invoice_not_found'); end if;
  if v_invoice.status not in ('issued','partially_paid','overdue') then
    return jsonb_build_object('ok',false,'reason','invoice_not_payable');
  end if;
  if upper(p_currency_code)<>v_invoice.currency_code then
    return jsonb_build_object('ok',false,'reason','invalid_currency');
  end if;
  if p_payment_date < v_invoice.issue_date then return jsonb_build_object('ok',false,'reason','invalid_payment'); end if;
  v_remaining := v_invoice.total_minor-v_invoice.amount_paid_minor;
  if p_amount_minor>v_remaining then return jsonb_build_object('ok',false,'reason','overpayment','remaining_minor',v_remaining); end if;

  insert into global.invoice_payments(
    workspace_id,invoice_id,amount_minor,currency_code,payment_date,method,reference,notes,recorded_by,idempotency_key
  ) values (
    p_workspace_id,p_invoice_id,p_amount_minor,v_invoice.currency_code,p_payment_date,
    nullif(btrim(p_method),''),nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),p_user_id,p_idempotency_key
  ) returning * into v_payment;

  v_new_paid := v_invoice.amount_paid_minor+p_amount_minor;
  v_new_status := case when v_new_paid=v_invoice.total_minor then 'paid' else 'partially_paid' end;
  update global.invoices set amount_paid_minor=v_new_paid,status=v_new_status,updated_at=now()
  where id=p_invoice_id and workspace_id=p_workspace_id
  returning * into v_invoice;

  return jsonb_build_object('ok',true,'duplicate',false,'payment',to_jsonb(v_payment),'invoice',to_jsonb(v_invoice));
end;
$function$;

revoke all on function public.global_create_invoice_draft(uuid,uuid,uuid,text,date,date,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.global_record_invoice_payment(uuid,uuid,uuid,bigint,text,date,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.global_create_invoice_draft(uuid,uuid,uuid,text,date,date,text,jsonb,uuid) to service_role;
grant execute on function public.global_record_invoice_payment(uuid,uuid,uuid,bigint,text,date,text,text,text,uuid) to service_role;

commit;
