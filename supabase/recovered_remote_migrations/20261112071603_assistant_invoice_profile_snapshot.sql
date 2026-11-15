CREATE OR REPLACE FUNCTION public.execute_assistant_action_batch(p_idempotency_key text, p_request_hash text, p_actions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id text;
  v_batch_id uuid;
  v_existing public.assistant_action_batches%rowtype;
  v_action jsonb;
  v_payload jsonb;
  v_type text;
  v_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_required_role app_role[];
  v_count integer := 0;
  v_invoice public.invoices;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce(length(trim(p_idempotency_key)),0) < 16 or coalesce(length(trim(p_idempotency_key)),0) > 160 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  if coalesce(length(trim(p_request_hash)),0) < 16 or jsonb_typeof(p_actions) <> 'array'
     or jsonb_array_length(p_actions) < 1 or jsonb_array_length(p_actions) > 10 then raise exception 'INVALID_ACTION_BATCH'; end if;
  select workspace_id into v_workspace_id from public.profiles where id = v_user_id;
  if v_workspace_id is null then raise exception 'WORKSPACE_NOT_FOUND'; end if;

  insert into public.assistant_action_batches(workspace_id,user_id,idempotency_key,request_hash)
  values(v_workspace_id,v_user_id,p_idempotency_key,p_request_hash)
  on conflict (workspace_id,idempotency_key) do nothing;
  select * into v_existing from public.assistant_action_batches
   where workspace_id=v_workspace_id and idempotency_key=p_idempotency_key for update;
  if v_existing.user_id <> v_user_id then raise exception 'IDEMPOTENCY_OWNER_MISMATCH'; end if;
  if v_existing.request_hash <> p_request_hash then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
  if v_existing.status = 'completed' then return coalesce(v_existing.result,'{}'::jsonb) || jsonb_build_object('duplicate',true); end if;
  v_batch_id := v_existing.id;

  for v_action in select value from jsonb_array_elements(p_actions) loop
    v_count := v_count + 1;
    v_type := v_action->>'type';
    v_payload := coalesce(v_action->'payload','{}'::jsonb);
    v_required_role := case v_type
      when 'create_expense' then array['admin','manager']::app_role[]
      when 'create_stock' then array['admin','manager','storekeeper']::app_role[]
      when 'create_client' then array['admin','manager']::app_role[]
      when 'create_lead' then array['admin','manager']::app_role[]
      when 'create_quotation' then array['admin','manager','employee']::app_role[]
      when 'create_invoice' then array['admin','manager','employee']::app_role[]
      else null end;
    if v_required_role is null then raise exception 'UNSUPPORTED_ACTION:%', coalesce(v_type,'null'); end if;
    if not public.has_ws_role(v_workspace_id, v_required_role) then raise exception 'PERMISSION_DENIED:%', v_type; end if;

    if v_type = 'create_invoice' then
      if jsonb_typeof(v_payload->'items') <> 'array' or jsonb_array_length(v_payload->'items') < 1 then raise exception 'MISSING_INVOICE_ITEMS'; end if;
      if nullif(trim(v_payload->>'client_name'),'') is null then raise exception 'MISSING_INVOICE_CLIENT'; end if;
      select * into v_invoice from public.save_invoice(
        jsonb_build_object(
          'client_name', left(v_payload->>'client_name',120),
          'client_email', left(coalesce(v_payload->>'client_email',''),180),
          'business_name', left(coalesce(v_payload->>'business_name',''),160),
          'issue_date', v_payload->>'issue_date',
          'due_date', v_payload->>'due_date',
          'currency', coalesce(nullif(v_payload->>'currency',''),'INR'),
          'tax_mode', coalesce(nullif(v_payload->>'tax_mode',''),'split'),
          'tax_rate', coalesce(nullif(v_payload->>'tax_rate','')::numeric,0),
          'discount_type', coalesce(nullif(v_payload->>'discount_type',''),'percent'),
          'discount', coalesce(nullif(v_payload->>'discount','')::numeric,0),
          'notes', left(coalesce(v_payload->>'notes',''),1000),
          'terms', left(coalesce(v_payload->>'terms',''),1000),
          'invoice_snapshot', v_payload->'invoice_snapshot',
          'status', 'Pending',
          'is_draft', true
        ),
        v_payload->'items',
        null
      );
      v_id := v_invoice.id;
    elsif v_type = 'create_expense' then
      if nullif(trim(v_payload->>'amount'),'') is null or (v_payload->>'amount')::numeric <= 0 then raise exception 'MISSING_OR_INVALID_AMOUNT'; end if;
      insert into public.expenses(workspace_id,vendor,category,amount,date,status,method,notes)
      values(v_workspace_id,nullif(v_payload->>'vendor',''),coalesce(nullif(v_payload->>'category',''),'Other'),
        (v_payload->>'amount')::numeric,coalesce(nullif(v_payload->>'date','')::date,public.ist_today()),
        nullif(v_payload->>'status',''),nullif(v_payload->>'method',''),nullif(v_payload->>'notes','')) returning id into v_id;
    elsif v_type = 'create_stock' then
      if nullif(trim(v_payload->>'name'),'') is null or nullif(v_payload->>'quantity','') is null or nullif(v_payload->>'price','') is null then raise exception 'MISSING_STOCK_FIELDS'; end if;
      if (v_payload->>'quantity')::numeric <= 0 or (v_payload->>'price')::numeric < 0 then raise exception 'INVALID_STOCK_VALUES'; end if;
      insert into public.stock(workspace_id,name,sku,quantity,unit,price,low_stock)
      values(v_workspace_id,trim(v_payload->>'name'),nullif(v_payload->>'sku',''),(v_payload->>'quantity')::numeric,
        coalesce(nullif(v_payload->>'unit',''),'pcs'),(v_payload->>'price')::numeric,coalesce(nullif(v_payload->>'low_stock','')::numeric,5)) returning id into v_id;
    elsif v_type = 'create_client' then
      if nullif(trim(v_payload->>'name'),'') is null then raise exception 'MISSING_CLIENT_NAME'; end if;
      insert into public.clients(workspace_id,name,company,email,phone,gstin,address)
      values(v_workspace_id,trim(v_payload->>'name'),nullif(v_payload->>'company',''),nullif(v_payload->>'email',''),
        nullif(v_payload->>'phone',''),nullif(v_payload->>'gstin',''),nullif(v_payload->>'address','')) returning id into v_id;
    elsif v_type = 'create_lead' then
      if nullif(trim(v_payload->>'name'),'') is null then raise exception 'MISSING_LEAD_NAME'; end if;
      insert into public.leads(workspace_id,name,phone,requirement,value,stage)
      values(v_workspace_id,trim(v_payload->>'name'),nullif(v_payload->>'phone',''),nullif(v_payload->>'requirement',''),
        coalesce(nullif(v_payload->>'value','')::numeric,0),coalesce(nullif(v_payload->>'stage',''),'New')) returning id into v_id;
    elsif v_type = 'create_quotation' then
      if nullif(trim(v_payload->>'client_name'),'') is null or nullif(v_payload->>'total','') is null then raise exception 'MISSING_QUOTATION_FIELDS'; end if;
      insert into public.quotations(workspace_id,client_name,total,date,status,tax_rate,items)
      values(v_workspace_id,trim(v_payload->>'client_name'),(v_payload->>'total')::numeric,
        coalesce(nullif(v_payload->>'date','')::date,public.ist_today()),coalesce(nullif(v_payload->>'status',''),'draft'),
        coalesce(nullif(v_payload->>'tax_rate','')::numeric,0),coalesce(v_payload->'items','[]'::jsonb)) returning id into v_id;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('type',v_type,'id',v_id));
  end loop;

  update public.assistant_action_batches set status='completed', result=jsonb_build_object('ok',true,'created',v_results), completed_at=now() where id=v_batch_id;
  return jsonb_build_object('ok',true,'created',v_results,'batch_id',v_batch_id);
exception when others then raise;
end;
$function$
