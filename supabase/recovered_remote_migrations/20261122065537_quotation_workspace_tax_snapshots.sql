
alter table global.quotations
  add column if not exists tax_minor bigint not null default 0,
  add column if not exists total_including_tax_minor bigint,
  add column if not exists tax_snapshot jsonb;
update global.quotations set total_including_tax_minor=total_minor where total_including_tax_minor is null;
create or replace function public.global_manage_quotation(
  p_user_id uuid,p_workspace_id uuid,p_action text,p_quotation_id uuid,p_client_id uuid,
  p_currency_code text,p_issue_date date,p_valid_until date,p_notes text,p_items jsonb,
  p_status text,p_idempotency_key uuid,p_tax_minor bigint,p_tax_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global,public as $$
declare v_result jsonb; v_quote_id uuid; v_quote global.quotations%rowtype;
begin
  if p_tax_minor is not null and (p_tax_minor<0 or p_tax_minor>9000000000000000) then
    return jsonb_build_object('ok',false,'reason','invalid_tax_amount');
  end if;
  if p_tax_snapshot is not null and jsonb_typeof(p_tax_snapshot)<>'object' then
    return jsonb_build_object('ok',false,'reason','invalid_tax_snapshot');
  end if;
  v_result:=public.global_manage_quotation(p_user_id,p_workspace_id,p_action,p_quotation_id,p_client_id,p_currency_code,p_issue_date,p_valid_until,p_notes,p_items,p_status,p_idempotency_key);
  if coalesce((v_result->>'ok')::boolean,false) is not true then return v_result; end if;
  if p_action='create' and p_tax_minor is not null then
    v_quote_id:=nullif(v_result->'quotation'->>'id','')::uuid;
    if v_quote_id is null then return jsonb_build_object('ok',false,'reason','quotation_save_failed'); end if;
    update global.quotations set tax_minor=p_tax_minor,total_including_tax_minor=total_minor+p_tax_minor,tax_snapshot=p_tax_snapshot,updated_at=now()
      where id=v_quote_id and workspace_id=p_workspace_id returning * into v_quote;
    if v_quote.id is null then return jsonb_build_object('ok',false,'reason','quotation_not_found'); end if;
    v_result:=jsonb_set(v_result,'{quotation}',to_jsonb(v_quote),true);
  end if;
  return v_result;
end; $$;
revoke all on function public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb) from public,anon;
grant execute on function public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb) to service_role;
