-- Allow the authenticated, workspace-scoped Part 4 list API to read saved Global suppliers.
-- Supplier data remains in the private global schema; this RPC returns only the fields needed for GSTIN lookup.
begin;
create or replace function public.global_part4_list(
  p_user_id uuid,p_workspace_id uuid,p_resource text,p_limit integer default 100
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,global
as $$
declare v_role text; v_rows jsonb;
begin
  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if p_resource not in ('warehouses','warehouse_stock_levels','inventory_batches','warehouse_stock_movements','stock_transfers','purchase_orders','purchase_order_items','crm_leads','crm_activities','suppliers') then
    return jsonb_build_object('ok',false,'reason','unsupported_resource');
  end if;
  case p_resource
    when 'warehouses' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.warehouses where workspace_id=p_workspace_id order by is_default desc,name limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'warehouse_stock_levels' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.warehouse_stock_levels where workspace_id=p_workspace_id order by updated_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'inventory_batches' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.inventory_batches where workspace_id=p_workspace_id order by expires_on nulls last,created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'stock_transfers' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.stock_transfers where workspace_id=p_workspace_id order by created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'purchase_orders' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.purchase_orders where workspace_id=p_workspace_id order by order_date desc,created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'purchase_order_items' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.purchase_order_items where workspace_id=p_workspace_id order by purchase_order_id limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'crm_leads' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.crm_leads where workspace_id=p_workspace_id order by updated_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;
    when 'crm_activities' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from (select * from global.crm_activities where workspace_id=p_workspace_id order by created_at desc limit greatest(1,least(coalesce(p_limit,100),500))) x;\n    when 'suppliers' then select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'email',x.email,'phone',x.phone,'tax_registration_number',x.tax_registration_number)),'[]'::jsonb) into v_rows from (select id,name,email,phone,tax_registration_number from global.suppliers where workspace_id=p_workspace_id order by lower(name),id limit greatest(1,least(coalesce(p_limit,100),500))) x;
  end case;
  return jsonb_build_object('ok',true,'records',coalesce(v_rows,'[]'::jsonb));
end $$;
revoke all on function public.global_part4_list(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.global_part4_list(uuid,uuid,text,integer) to service_role;
commit;
