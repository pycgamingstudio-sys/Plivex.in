-- Global-only business records RPC.
-- The global schema stays private and is not added to PostgREST's exposed schemas.
-- Edge Functions authenticate the Supabase user; this service-role-only RPC
-- rechecks active workspace membership and applies a strict table/action allowlist.
begin;

create or replace function public.global_business_records(
  p_user_id uuid,
  p_workspace_id uuid,
  p_table text,
  p_action text,
  p_record_id uuid default null,
  p_values jsonb default '{}'::jsonb,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_currency text;
  v_records jsonb := '[]'::jsonb;
  v_record jsonb;
  v_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if p_user_id is null or p_workspace_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_values');
  end if;
  if p_table not in ('clients','products','expenses','stock_levels','stock_movements','invoices','invoice_items','invoice_payments') then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_table');
  end if;
  if p_action not in ('list','create','update','delete') then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_action');
  end if;

  select wm.role into v_role
  from global.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_user_id
    and wm.status = 'active'
  limit 1;
  if v_role is null then
    return jsonb_build_object('ok', false, 'reason', 'access_denied');
  end if;

  select w.currency_code into v_currency
  from global.workspaces w
  where w.id = p_workspace_id;
  if v_currency is null then
    return jsonb_build_object('ok', false, 'reason', 'workspace_not_found');
  end if;

  if p_action = 'list' then
    case p_table
      when 'clients' then
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_records
        from (select * from global.clients where workspace_id=p_workspace_id order by created_at desc limit v_limit) t;
      when 'products' then
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_records
        from (select * from global.products where workspace_id=p_workspace_id order by created_at desc limit v_limit) t;
      when 'expenses' then
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_records
        from (select * from global.expenses where workspace_id=p_workspace_id order by expense_date desc, created_at desc limit v_limit) t;
      when 'stock_levels' then
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_records
        from (select * from global.stock_levels where workspace_id=p_workspace_id order by product_id limit v_limit) t;
      when 'stock_movements' then
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_records
        from (select * from global.stock_movements where workspace_id=p_workspace_id order by created_at desc limit v_limit) t;
      when 'invoices' then
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_records
        from (select * from global.invoices where workspace_id=p_workspace_id order by issue_date desc, created_at desc limit v_limit) t;
      when 'invoice_items' then
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_records
        from (select * from global.invoice_items where workspace_id=p_workspace_id order by invoice_id, sort_order limit v_limit) t;
      when 'invoice_payments' then
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_records
        from (select * from global.invoice_payments where workspace_id=p_workspace_id order by payment_date desc, created_at desc limit v_limit) t;
    end case;
    return jsonb_build_object('ok', true, 'currency_code', v_currency, 'records', v_records);
  end if;

  if p_table in ('stock_levels','stock_movements','invoices','invoice_items','invoice_payments') then
    return jsonb_build_object('ok', false, 'reason', 'read_only');
  end if;
  if p_table = 'expenses' then
    if v_role not in ('owner','admin','accountant') then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif v_role not in ('owner','admin','manager') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_action = 'create' then
    case p_table
      when 'clients' then
        insert into global.clients(
          workspace_id,name,email,phone,tax_registration_number,billing_address,shipping_address,notes,status,created_by
        ) values (
          p_workspace_id,p_values->>'name',p_values->>'email',p_values->>'phone',
          p_values->>'tax_registration_number',coalesce(p_values->'billing_address','{}'::jsonb),
          coalesce(p_values->'shipping_address','{}'::jsonb),p_values->>'notes',
          coalesce(p_values->>'status','active'),p_user_id
        ) returning to_jsonb(global.clients.*) into v_record;
      when 'products' then
        insert into global.products(
          workspace_id,name,sku,description,unit,sale_price_minor,purchase_cost_minor,currency_code,tax_code,is_active,created_by
        ) values (
          p_workspace_id,p_values->>'name',p_values->>'sku',p_values->>'description',
          coalesce(nullif(p_values->>'unit',''),'unit'),
          coalesce(nullif(p_values->>'sale_price_minor','')::bigint,0),
          coalesce(nullif(p_values->>'purchase_cost_minor','')::bigint,0),
          coalesce(p_values->>'currency_code',v_currency),p_values->>'tax_code',
          coalesce((p_values->>'is_active')::boolean,true),p_user_id
        ) returning to_jsonb(global.products.*) into v_record;
      when 'expenses' then
        insert into global.expenses(
          workspace_id,category,vendor,amount_minor,currency_code,expense_date,payment_method,reference,notes,attachment_url,created_by
        ) values (
          p_workspace_id,p_values->>'category',p_values->>'vendor',
          (p_values->>'amount_minor')::bigint,coalesce(p_values->>'currency_code',v_currency),
          coalesce(nullif(p_values->>'expense_date','')::date,current_date),
          p_values->>'payment_method',p_values->>'reference',p_values->>'notes',p_values->>'attachment_url',p_user_id
        ) returning to_jsonb(global.expenses.*) into v_record;
    end case;
    return jsonb_build_object('ok', true, 'record', v_record, 'currency_code', v_currency);
  end if;

  if p_record_id is null then
    return jsonb_build_object('ok', false, 'reason', 'record_id_required');
  end if;

  if p_action = 'update' then
    case p_table
      when 'clients' then
        update global.clients set
          name=case when p_values ? 'name' then p_values->>'name' else name end,
          email=case when p_values ? 'email' then p_values->>'email' else email end,
          phone=case when p_values ? 'phone' then p_values->>'phone' else phone end,
          tax_registration_number=case when p_values ? 'tax_registration_number' then p_values->>'tax_registration_number' else tax_registration_number end,
          billing_address=case when p_values ? 'billing_address' then p_values->'billing_address' else billing_address end,
          shipping_address=case when p_values ? 'shipping_address' then p_values->'shipping_address' else shipping_address end,
          notes=case when p_values ? 'notes' then p_values->>'notes' else notes end,
          status=case when p_values ? 'status' then p_values->>'status' else status end
        where id=p_record_id and workspace_id=p_workspace_id
        returning to_jsonb(global.clients.*) into v_record;
      when 'products' then
        update global.products set
          name=case when p_values ? 'name' then p_values->>'name' else name end,
          sku=case when p_values ? 'sku' then p_values->>'sku' else sku end,
          description=case when p_values ? 'description' then p_values->>'description' else description end,
          unit=case when p_values ? 'unit' then p_values->>'unit' else unit end,
          sale_price_minor=case when p_values ? 'sale_price_minor' then (p_values->>'sale_price_minor')::bigint else sale_price_minor end,
          purchase_cost_minor=case when p_values ? 'purchase_cost_minor' then (p_values->>'purchase_cost_minor')::bigint else purchase_cost_minor end,
          currency_code=case when p_values ? 'currency_code' then p_values->>'currency_code' else currency_code end,
          tax_code=case when p_values ? 'tax_code' then p_values->>'tax_code' else tax_code end,
          is_active=case when p_values ? 'is_active' then (p_values->>'is_active')::boolean else is_active end
        where id=p_record_id and workspace_id=p_workspace_id
        returning to_jsonb(global.products.*) into v_record;
      when 'expenses' then
        update global.expenses set
          category=case when p_values ? 'category' then p_values->>'category' else category end,
          vendor=case when p_values ? 'vendor' then p_values->>'vendor' else vendor end,
          amount_minor=case when p_values ? 'amount_minor' then (p_values->>'amount_minor')::bigint else amount_minor end,
          currency_code=case when p_values ? 'currency_code' then p_values->>'currency_code' else currency_code end,
          expense_date=case when p_values ? 'expense_date' then (p_values->>'expense_date')::date else expense_date end,
          payment_method=case when p_values ? 'payment_method' then p_values->>'payment_method' else payment_method end,
          reference=case when p_values ? 'reference' then p_values->>'reference' else reference end,
          notes=case when p_values ? 'notes' then p_values->>'notes' else notes end,
          attachment_url=case when p_values ? 'attachment_url' then p_values->>'attachment_url' else attachment_url end
        where id=p_record_id and workspace_id=p_workspace_id
        returning to_jsonb(global.expenses.*) into v_record;
    end case;
    if v_record is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    return jsonb_build_object('ok', true, 'record', v_record, 'currency_code', v_currency);
  end if;

  delete from global.clients where p_table='clients' and id=p_record_id and workspace_id=p_workspace_id returning id into v_id;
  if p_table='products' then
    delete from global.products where id=p_record_id and workspace_id=p_workspace_id returning id into v_id;
  elsif p_table='expenses' then
    delete from global.expenses where id=p_record_id and workspace_id=p_workspace_id returning id into v_id;
  end if;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;

revoke all on function public.global_business_records(uuid,uuid,text,text,uuid,jsonb,integer) from public, anon, authenticated;
grant execute on function public.global_business_records(uuid,uuid,text,text,uuid,jsonb,integer) to service_role;

comment on function public.global_business_records(uuid,uuid,text,text,uuid,jsonb,integer) is
  'Service-role-only Global business record RPC. Revalidates active Global membership; the global schema remains private and is not exposed through PostgREST.';

commit;
