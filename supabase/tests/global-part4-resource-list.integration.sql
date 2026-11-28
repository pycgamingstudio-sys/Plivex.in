-- Disposable migration-replay assertions for the Main Workspace Part 4 read catalogue.
do $part4_resource_list$
declare
  v_definition text;
  v_signature regprocedure := 'public.global_part4_list(uuid,uuid,text,integer)'::regprocedure;
begin
  if v_signature is null then
    raise exception 'global_part4_list RPC is missing';
  end if;

  v_definition := lower(pg_get_functiondef(v_signature));
  foreach v_resource in array array[
    'warehouses', 'warehouse_stock_levels', 'inventory_batches',
    'warehouse_stock_movements', 'stock_transfers', 'purchase_orders',
    'purchase_order_items', 'crm_leads', 'crm_activities', 'suppliers',
    'sales_orders', 'delivery_challans', 'credit_debit_notes', 'inventory_serials'
  ] loop
    if position('when ''' || v_resource || '''' in v_definition) = 0 then
      raise exception 'global_part4_list is missing resource case %', v_resource;
    end if;
  end loop;

  if has_function_privilege('anon', v_signature, 'EXECUTE')
     or has_function_privilege('authenticated', v_signature, 'EXECUTE') then
    raise exception 'global_part4_list must not be directly executable by client roles';
  end if;
  if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
    raise exception 'service_role cannot execute global_part4_list';
  end if;
end
$part4_resource_list$;
