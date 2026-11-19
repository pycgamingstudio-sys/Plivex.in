-- Atomic Global commercial invoice creation and issuance.
-- A final invoice is never returned as a draft: draft creation and issuance run
-- in one database transaction, and any issuance failure removes the intermediate draft.
begin;

create or replace function public.global_create_and_issue_commercial_invoice(
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
  v_created jsonb;
  v_issued jsonb;
  v_invoice_id uuid;
begin
  if p_user_id is null or p_workspace_id is null or p_idempotency_key is null then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;

  v_created := public.global_create_invoice_draft(
    p_user_id,p_workspace_id,p_client_id,p_currency_code,p_issue_date,
    p_due_date,p_notes,p_items,p_idempotency_key
  );
  if coalesce((v_created->>'ok')::boolean,false) is not true then
    return v_created;
  end if;

  v_invoice_id := nullif(v_created->'invoice'->>'id','')::uuid;
  if v_invoice_id is null then
    return jsonb_build_object('ok',false,'reason','invoice_creation_failed');
  end if;

  v_issued := public.global_issue_commercial_invoice(
    p_user_id,p_workspace_id,v_invoice_id,p_idempotency_key
  );
  if coalesce((v_issued->>'ok')::boolean,false) is not true then
    -- The draft exists only as an internal staging row. Remove it before
    -- returning failure so the user never receives a half-created final invoice.
    delete from global.invoice_items
    where invoice_id=v_invoice_id and workspace_id=p_workspace_id;
    delete from global.invoices
    where id=v_invoice_id and workspace_id=p_workspace_id and status='draft';
    return v_issued;
  end if;

  return v_issued;
end;
$function$;

create or replace function public.global_create_and_issue_tax_invoice(
  p_user_id uuid,
  p_workspace_id uuid,
  p_client_id uuid,
  p_currency_code text,
  p_issue_date date,
  p_due_date date,
  p_notes text,
  p_items jsonb,
  p_tax_context jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_created jsonb;
  v_issued jsonb;
  v_invoice_id uuid;
begin
  if p_user_id is null or p_workspace_id is null or p_idempotency_key is null
    or jsonb_typeof(coalesce(p_tax_context,'null')) <> 'object' then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;

  v_created := public.global_create_invoice_draft(
    p_user_id,p_workspace_id,p_client_id,p_currency_code,p_issue_date,
    p_due_date,p_notes,p_items,p_idempotency_key
  );
  if coalesce((v_created->>'ok')::boolean,false) is not true then
    return v_created;
  end if;

  v_invoice_id := nullif(v_created->'invoice'->>'id','')::uuid;
  if v_invoice_id is null then
    return jsonb_build_object('ok',false,'reason','invoice_creation_failed');
  end if;

  v_issued := public.global_issue_invoice(
    p_user_id,p_workspace_id,v_invoice_id,p_tax_context,p_idempotency_key
  );
  if coalesce((v_issued->>'ok')::boolean,false) is not true then
    delete from global.invoice_items
    where invoice_id=v_invoice_id and workspace_id=p_workspace_id;
    delete from global.invoices
    where id=v_invoice_id and workspace_id=p_workspace_id and status='draft';
    return v_issued;
  end if;

  return v_issued;
end;
$function$;

revoke all on function public.global_create_and_issue_tax_invoice(uuid,uuid,uuid,text,date,date,text,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.global_create_and_issue_tax_invoice(uuid,uuid,uuid,text,date,date,text,jsonb,jsonb,uuid) to service_role;

revoke all on function public.global_create_and_issue_commercial_invoice(uuid,uuid,uuid,text,date,date,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.global_create_and_issue_commercial_invoice(uuid,uuid,uuid,text,date,date,text,jsonb,uuid) to service_role;

commit;
