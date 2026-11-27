begin;

-- Tax amounts and snapshots are computed by the authenticated Edge Function.
-- Keep this privileged overload service-role-only so browser clients cannot
-- bypass the server-side tax-rule resolver with caller-supplied amounts.
-- The legacy overload independently validates active workspace membership.
create or replace function public.global_manage_quotation(
  p_user_id uuid,
  p_workspace_id uuid,
  p_action text,
  p_quotation_id uuid,
  p_client_id uuid,
  p_currency_code text,
  p_issue_date date,
  p_valid_until date,
  p_notes text,
  p_items jsonb,
  p_status text,
  p_idempotency_key uuid,
  p_tax_minor bigint,
  p_tax_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global, public
as $function$
declare
  v_result jsonb;
  v_quote_id uuid;
  v_quote global.quotations%rowtype;
  v_invoice global.invoices%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    return jsonb_build_object('ok',false,'reason','access_denied');
  end if;

  if p_tax_minor is not null and (p_tax_minor < 0 or p_tax_minor > 9000000000000000) then
    return jsonb_build_object('ok',false,'reason','invalid_tax_amount');
  end if;
  if p_tax_snapshot is not null and jsonb_typeof(p_tax_snapshot) <> 'object' then
    return jsonb_build_object('ok',false,'reason','invalid_tax_snapshot');
  end if;

  v_result := public.global_manage_quotation(
    p_user_id,p_workspace_id,p_action,p_quotation_id,p_client_id,p_currency_code,
    p_issue_date,p_valid_until,p_notes,p_items,p_status,p_idempotency_key
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true then
    return v_result;
  end if;

  if p_action = 'create' and p_tax_minor is not null then
    v_quote_id := nullif(v_result->'quotation'->>'id','')::uuid;
    if v_quote_id is null then
      return jsonb_build_object('ok',false,'reason','quotation_save_failed');
    end if;
    update global.quotations
      set tax_minor=p_tax_minor,
          total_including_tax_minor=total_minor+p_tax_minor,
          tax_snapshot=p_tax_snapshot,
          updated_at=now()
      where id=v_quote_id and workspace_id=p_workspace_id
      returning * into v_quote;
    if v_quote.id is null then
      return jsonb_build_object('ok',false,'reason','quotation_not_found');
    end if;
    v_result := jsonb_set(v_result,'{quotation}',to_jsonb(v_quote),true);
  elsif p_action = 'convert' then
    select * into v_quote from global.quotations
      where id=p_quotation_id and workspace_id=p_workspace_id;
    if v_quote.converted_invoice_id is not null and v_quote.tax_snapshot is not null then
      update global.invoices
        set tax_minor=v_quote.tax_minor,
            total_minor=coalesce(v_quote.total_including_tax_minor,v_quote.total_minor),
            invoice_snapshot=coalesce(invoice_snapshot,'{}'::jsonb)
              || jsonb_build_object('global_tax_snapshot',v_quote.tax_snapshot),
            updated_at=now()
        where id=v_quote.converted_invoice_id and workspace_id=p_workspace_id
        returning * into v_invoice;
      if v_invoice.id is not null then
        v_result := jsonb_set(v_result,'{invoice}',to_jsonb(v_invoice),true);
      end if;
    end if;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.global_manage_quotation(
  uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb
) from public, anon, authenticated;
grant execute on function public.global_manage_quotation(
  uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb
) to service_role;

-- Purchase-bill listing is a read-only authenticated workspace RPC.
-- Keep it invoker-security so table RLS remains in force, and bind the supplied
-- user id to auth.uid() for browser callers. Trusted service-role callers remain
-- available for server-side jobs.
create or replace function public.global_list_purchase_bills(
  p_user_id uuid,
  p_workspace_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to pg_catalog, global, public
as $function$
declare
  v_role text;
  v_rows jsonb;
begin
  if p_user_id is null or p_workspace_id is null then
    raise exception using errcode='42501', message='Workspace access denied';
  end if;
  if current_user <> 'service_role' and p_user_id is distinct from auth.uid() then
    raise exception using errcode='42501', message='Workspace access denied';
  end if;

  select role into v_role
  from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active';
  if v_role is null then
    raise exception using errcode='42501', message='Workspace access denied';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.purchase_date desc,t.created_at desc),'[]'::jsonb)
  into v_rows
  from (
    select b.*,s.name as supplier_name,s.tax_registration_number as supplier_tax_id
    from global.purchase_bills b
    join global.suppliers s on s.workspace_id=b.workspace_id and s.id=b.supplier_id
    where b.workspace_id=p_workspace_id
    order by b.purchase_date desc,b.created_at desc
    limit greatest(1,least(coalesce(p_limit,100),200))
  ) t;

  return jsonb_build_object('ok',true,'purchase_bills',v_rows);
end;
$function$;

revoke all on function public.global_list_purchase_bills(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.global_list_purchase_bills(uuid,uuid,integer) to authenticated, service_role;

-- Trigger functions are invoked by their owning trigger and must not be callable
-- as an exposed RPC by anon/authenticated clients.
revoke all on function global.guard_issued_invoice_items() from public, anon, authenticated;

commit;
