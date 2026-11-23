-- List Main Workspace sales documents and enforce ordered fulfillment transitions.
begin;
create or replace function public.main_workspace_list_sales_documents(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_rows jsonb;v_challans jsonb;v_notes jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',so.id,'order_number',so.order_number,'client_name',so.client_name,'currency_code',so.currency_code,'status',so.status,'order_date',so.order_date,'expected_date',so.expected_date,'subtotal',so.subtotal,'tax_total',so.tax_total,'total',so.total,'created_at',so.created_at,'items',(select coalesce(jsonb_agg(jsonb_build_object('id',si.id,'stock_id',si.stock_id,'description',si.description,'quantity',si.quantity,'unit_price',si.unit_price,'tax_rate',si.tax_rate,'line_total',si.line_total,'delivered_quantity',coalesce((select sum(dci.quantity) from public.delivery_challan_items dci join public.delivery_challans dc on dc.id=dci.delivery_challan_id where dci.sales_order_item_id=si.id and dc.status in ('dispatched','received')),0)) order by si.id),'[]'::jsonb) from public.sales_order_items si where si.sales_order_id=so.id)) order by so.created_at desc),'[]'::jsonb)
 into v_rows from public.sales_orders so where so.workspace_id=p_workspace_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',dc.id,'challan_number',dc.challan_number,'sales_order_id',dc.sales_order_id,'client_name',dc.client_name,'dispatch_date',dc.dispatch_date,'status',dc.status,'created_at',dc.created_at,'items',(select coalesce(jsonb_agg(jsonb_build_object('description',dci.description,'quantity',dci.quantity) order by dci.id),'[]'::jsonb) from public.delivery_challan_items dci where dci.delivery_challan_id=dc.id)) order by dc.created_at desc),'[]'::jsonb)
 into v_challans from public.delivery_challans dc where dc.workspace_id=p_workspace_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'note_number',n.note_number,'invoice_id',n.invoice_id,'invoice_number',i.number,'note_type',n.note_type,'reason',n.reason,'amount',n.amount,'currency_code',n.currency_code,'status',n.status,'created_at',n.created_at) order by n.created_at desc),'[]'::jsonb)
 into v_notes from public.credit_debit_notes n join public.invoices i on i.id=n.invoice_id where n.workspace_id=p_workspace_id;
 return jsonb_build_object('ok',true,'sales_orders',v_rows,'delivery_challans',v_challans,'credit_debit_notes',v_notes);
end; $function$;
create or replace function public.main_workspace_set_sales_document_status(p_workspace_id text,p_document_type text,p_document_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_found uuid;v_amount numeric;v_invoice uuid;v_invoice_total numeric;v_order_id uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_document_type='sales_order' and p_status in ('confirmed','cancelled','fulfilled') then
  update public.sales_orders set status=p_status,updated_at=now() where workspace_id=p_workspace_id and id=p_document_id and ((p_status='confirmed' and status='draft') or (p_status='cancelled' and status in ('draft','confirmed','partially_fulfilled')) or (p_status='fulfilled' and status='partially_fulfilled')) returning id into v_found;
 elsif p_document_type='delivery_challan' and p_status in ('dispatched','received','cancelled') then
  update public.delivery_challans set status=p_status,updated_at=now() where workspace_id=p_workspace_id and id=p_document_id and ((p_status='dispatched' and status='draft') or (p_status='received' and status='dispatched') or (p_status='cancelled' and status in ('draft','dispatched'))) returning id,sales_order_id into v_found,v_order_id;
  if v_found is not null and p_status in ('received','cancelled') then
   update public.sales_orders so set status=case when p_status='cancelled' then 'partially_fulfilled' when not exists(
    select 1 from public.sales_order_items si where si.sales_order_id=so.id and si.quantity>coalesce((select sum(dci.quantity) from public.delivery_challan_items dci join public.delivery_challans dc on dc.id=dci.delivery_challan_id where dci.sales_order_item_id=si.id and dc.status in ('dispatched','received')),0)
   ) then 'fulfilled' else 'partially_fulfilled' end,updated_at=now() where so.id=v_order_id and so.workspace_id=p_workspace_id;
  end if;
 elsif p_document_type='credit_debit_note' and p_status in ('issued','cancelled') then
  select invoice_id,amount into v_invoice,v_amount from public.credit_debit_notes where workspace_id=p_workspace_id and id=p_document_id and status='draft' and note_type='credit' for update;
  if v_invoice is not null and p_status='issued' then
   select total into v_invoice_total from public.invoices where workspace_id=p_workspace_id and id=v_invoice for update;
   if (select coalesce(sum(amount),0) from public.credit_debit_notes where workspace_id=p_workspace_id and invoice_id=v_invoice and note_type='credit' and status='issued')+v_amount>v_invoice_total then return jsonb_build_object('ok',false,'reason','credit_exceeds_remaining_invoice_total'); end if;
  end if;
  update public.credit_debit_notes set status=p_status,updated_at=now() where workspace_id=p_workspace_id and id=p_document_id and status='draft' returning id into v_found;
 else return jsonb_build_object('ok',false,'reason','invalid_transition'); end if;
 if v_found is null then return jsonb_build_object('ok',false,'reason','document_not_found_or_transition_invalid'); end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,p_document_type||'.'||p_status,p_document_type,v_found::text,jsonb_build_object('status',p_status));
 return jsonb_build_object('ok',true);
end; $function$;
revoke all on function public.main_workspace_list_sales_documents(text) from public,anon;
grant execute on function public.main_workspace_list_sales_documents(text) to authenticated;
commit;
