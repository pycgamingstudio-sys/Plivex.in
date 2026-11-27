-- Bind bank statement and GSTR-2B idempotency keys to the imported payload.
-- Existing imports without fingerprints fail closed on key reuse; they are never
-- silently treated as a matching request.
begin;

alter table public.bank_statement_imports
  add column if not exists request_fingerprint text;
alter table public.workspace_gstr2b_imports
  add column if not exists request_fingerprint text;

create or replace function public.main_workspace_import_bank_statement(
 p_workspace_id text,p_bank_account_id uuid,p_rows jsonb,
 p_opening_balance numeric,p_closing_balance numeric,p_start date,p_end date,
 p_idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare
 v_user uuid:=auth.uid();
 v_account public.workspace_bank_accounts%rowtype;
 v_import public.bank_statement_imports%rowtype;
 v_row jsonb;
 v_date date;
 v_amount numeric;
 v_direction text;
 v_desc text;
 v_ref text;
 v_idx integer:=0;
 v_count integer:=0;
 v_key text;
 v_fingerprint text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then
  return jsonb_build_object('ok',false,'reason','forbidden');
 end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1
   or jsonb_array_length(p_rows)>5000 or p_idempotency_key is null
   or p_opening_balance is null or p_closing_balance is null
   or p_start is null or p_end is null or p_end<p_start then
  return jsonb_build_object('ok',false,'reason','invalid_statement');
 end if;
 select * into v_account from public.workspace_bank_accounts
 where workspace_id=p_workspace_id and id=p_bank_account_id and is_active;
 if not found then return jsonb_build_object('ok',false,'reason','bank_account_not_found'); end if;

 -- Canonicalize transaction order so equivalent CSV row ordering hashes equally.
 select md5(jsonb_build_object(
  'bank_account_id',p_bank_account_id,'opening_balance',p_opening_balance,
  'closing_balance',p_closing_balance,'start',p_start,'end',p_end,
  'currency',v_account.currency_code,
  'rows',coalesce(jsonb_agg(jsonb_build_object(
    'date',(x.value->>'date')::date,
    'amount',coalesce((x.value->>'amount')::numeric,0),
    'direction',lower(x.value->>'direction'),
    'description',nullif(btrim(x.value->>'description'),''),
    'reference',nullif(btrim(x.value->>'reference'),'')
  ) order by (x.value->>'date')::date,
    coalesce((x.value->>'amount')::numeric,0),
    lower(x.value->>'direction'),
    coalesce(nullif(btrim(x.value->>'reference'),''),''),
    coalesce(nullif(btrim(x.value->>'description'),''),'')),'[]'::jsonb)
 )::text) into v_fingerprint
 from jsonb_array_elements(p_rows) x(value);

 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id||':'||p_idempotency_key::text,0));
 select * into v_import from public.bank_statement_imports
 where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key for update;
 if found then
  if v_import.request_fingerprint is distinct from v_fingerprint then
   return jsonb_build_object('ok',false,'reason','idempotency_conflict');
  end if;
  return jsonb_build_object('ok',true,'import_id',v_import.id,'duplicate',true);
 end if;

 insert into public.bank_statement_imports(
  workspace_id,bank_account_id,statement_start,statement_end,opening_balance,
  closing_balance,currency_code,idempotency_key,request_fingerprint,created_by
 ) values (
  p_workspace_id,p_bank_account_id,p_start,p_end,p_opening_balance,
  p_closing_balance,v_account.currency_code,p_idempotency_key,v_fingerprint,v_user
 ) returning * into v_import;

 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_idx:=v_idx+1;
  v_date:=(v_row->>'date')::date;
  v_amount:=coalesce((v_row->>'amount')::numeric,0);
  v_direction:=lower(v_row->>'direction');
  v_desc:=nullif(btrim(v_row->>'description'),'');
  v_ref:=nullif(btrim(v_row->>'reference'),'');
  if v_date is null or v_date<p_start or v_date>p_end or v_amount<=0
    or v_direction not in ('debit','credit') or v_desc is null or length(v_desc)>500 then
   raise exception 'invalid_bank_transaction_row';
  end if;
  v_key:=md5(v_idx::text||'|'||v_date::text||'|'||v_amount::text||'|'||v_direction||'|'||coalesce(v_ref,'')||'|'||v_desc);
  insert into public.bank_statement_transactions(
   workspace_id,import_id,transaction_date,description,reference,amount,direction,
   currency_code,category,row_key
  ) values (
   p_workspace_id,v_import.id,v_date,v_desc,v_ref,v_amount,v_direction,v_account.currency_code,
   case when v_desc ~* '(rent|lease)' then 'Rent'
    when v_desc ~* '(salary|payroll)' then 'Salary'
    when v_desc ~* '(fuel|petrol|diesel)' then 'Fuel'
    when v_desc ~* '(electric|water|utility)' then 'Utilities'
    when v_desc ~* '(tax|gst|vat)' then 'Tax'
    when v_desc ~* '(software|subscription|cloud)' then 'Software'
    when v_direction='credit' then 'Customer receipt' else 'Uncategorised' end,v_key
  );
  v_count:=v_count+1;
 end loop;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_workspace_id,v_user,'bank.statement_imported','bank_statement_import',v_import.id::text,
  jsonb_build_object('rows',v_count,'currency_code',v_account.currency_code));
 return jsonb_build_object('ok',true,'import_id',v_import.id,'transaction_count',v_count);
exception when others then
 if sqlerrm='invalid_bank_transaction_row' then return jsonb_build_object('ok',false,'reason',sqlerrm); end if;
 raise;
end;
$function$;

create or replace function public.main_workspace_import_gstr2b(
 p_workspace_id text,p_period_start date,p_period_end date,p_file_name text,
 p_rows jsonb,p_import_key uuid
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare
 v_user uuid:=auth.uid();
 v_country text;
 v_import public.workspace_gstr2b_imports%rowtype;
 v_row jsonb;
 v_count integer:=0;
 v_inserted integer;
 v_gstin text;
 v_invoice text;
 v_date date;
 v_taxable numeric;
 v_cgst numeric;
 v_sgst numeric;
 v_igst numeric;
 v_fingerprint text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then
  return jsonb_build_object('ok',false,'reason','forbidden');
 end if;
 select country_code into v_country from public.workspace_settings where workspace_id=p_workspace_id;
 if upper(coalesce(v_country,''))<>'IN' then return jsonb_build_object('ok',false,'reason','india_workspace_required'); end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start
  or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1
  or jsonb_array_length(p_rows)>5000 or p_import_key is null then
  return jsonb_build_object('ok',false,'reason','invalid_gstr2b_import');
 end if;

 select md5(jsonb_build_object(
  'period_start',p_period_start,'period_end',p_period_end,
  'rows',coalesce(jsonb_agg(jsonb_build_object(
    'supplier_gstin',upper(btrim(x.value->>'supplier_gstin')),
    'invoice_number',btrim(x.value->>'invoice_number'),
    'invoice_date',(x.value->>'invoice_date')::date,
    'taxable_value',coalesce((x.value->>'taxable_value')::numeric,0),
    'cgst',coalesce((x.value->>'cgst')::numeric,0),
    'sgst',coalesce((x.value->>'sgst')::numeric,0),
    'igst',coalesce((x.value->>'igst')::numeric,0)
  ) order by upper(btrim(x.value->>'supplier_gstin')),
    btrim(x.value->>'invoice_number'),(x.value->>'invoice_date')::date,
    coalesce((x.value->>'taxable_value')::numeric,0),
    coalesce((x.value->>'cgst')::numeric,0),
    coalesce((x.value->>'sgst')::numeric,0),
    coalesce((x.value->>'igst')::numeric,0)),'[]'::jsonb)
 )::text) into v_fingerprint
 from jsonb_array_elements(p_rows) x(value);

 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id||':'||p_import_key::text,0));
 select * into v_import from public.workspace_gstr2b_imports
 where workspace_id=p_workspace_id and import_key=p_import_key for update;
 if found then
  if v_import.request_fingerprint is distinct from v_fingerprint then
   return jsonb_build_object('ok',false,'reason','idempotency_conflict');
  end if;
  return jsonb_build_object('ok',true,'import_id',v_import.id,'duplicate',true);
 end if;

 insert into public.workspace_gstr2b_imports(
  workspace_id,period_start,period_end,file_name,import_key,request_fingerprint,created_by
 ) values (
  p_workspace_id,p_period_start,p_period_end,left(coalesce(p_file_name,'GSTR2B'),200),
  p_import_key,v_fingerprint,v_user
 ) returning * into v_import;

 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_gstin:=upper(btrim(v_row->>'supplier_gstin'));
  v_invoice:=btrim(v_row->>'invoice_number');
  v_date:=(v_row->>'invoice_date')::date;
  v_taxable:=coalesce((v_row->>'taxable_value')::numeric,0);
  v_cgst:=coalesce((v_row->>'cgst')::numeric,0);
  v_sgst:=coalesce((v_row->>'sgst')::numeric,0);
  v_igst:=coalesce((v_row->>'igst')::numeric,0);
  if v_gstin !~ '^[0-9A-Z]{15}$' or v_invoice is null or v_invoice=''
   or v_date is null or v_date<p_period_start or v_date>p_period_end
   or v_taxable<0 or v_cgst<0 or v_sgst<0 or v_igst<0 then
   raise exception 'invalid_gstr2b_line';
  end if;
  insert into public.workspace_gstr2b_lines(
   workspace_id,import_id,supplier_gstin,invoice_number,invoice_date,
   taxable_value,cgst,sgst,igst
  ) values (
   p_workspace_id,v_import.id,v_gstin,left(v_invoice,100),v_date,
   v_taxable,v_cgst,v_sgst,v_igst
  ) on conflict(import_id,supplier_gstin,invoice_number,invoice_date) do nothing;
  get diagnostics v_inserted=row_count;
  v_count:=v_count+v_inserted;
 end loop;
 update public.workspace_gstr2b_imports set imported_rows=v_count where id=v_import.id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_workspace_id,v_user,'gst.gstr2b_imported','gstr2b_import',v_import.id::text,
  jsonb_build_object('rows',v_count,'period_start',p_period_start,'period_end',p_period_end));
 return jsonb_build_object('ok',true,'import_id',v_import.id,'imported_rows',v_count);
exception when others then
 if sqlerrm='invalid_gstr2b_line' then return jsonb_build_object('ok',false,'reason',sqlerrm); end if;
 raise;
end;
$function$;

commit;
