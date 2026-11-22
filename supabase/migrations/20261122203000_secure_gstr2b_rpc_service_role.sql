-- Keep GST import/calendar RPCs private to the authenticated Edge Function service role.
begin;
revoke all on global.gstr2b_import_rows from public,anon,authenticated;
grant all on global.gstr2b_import_rows to service_role;
revoke all on global.gst_filing_calendar from public,anon,authenticated;
grant all on global.gst_filing_calendar to service_role;
create or replace function public.global_import_gstr2b_rows(p_user_id uuid,p_workspace_id uuid,p_return_period text,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,global as $function$
declare v_role text; v_country text; v_row jsonb; v_count integer:=0; v_gstin text; v_invoice text; v_date date;
begin
  if p_user_id is null or p_workspace_id is null or p_return_period is null
    or p_return_period !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_rows is null
    or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>2000 then
    raise exception using errcode='22023',message='Invalid GSTR-2B import request';
  end if;
  select m.role,w.country_code into v_role,v_country from global.workspace_members m join global.workspaces w on w.id=m.workspace_id where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.status='active';
  if v_role is null then raise exception using errcode='42501',message='Workspace access denied'; end if;
  if v_country<>'IN' then raise exception using errcode='42501',message='GSTR-2B is available only for India workspaces'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_gstin:=upper(regexp_replace(coalesce(v_row->>'supplierGstin',''),'\s','','g'));
    v_invoice:=upper(btrim(coalesce(v_row->>'invoiceNumber','')));
    if v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'
      or v_invoice='' or length(v_invoice)>80 or coalesce(v_row->>'invoiceDate','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_row->>'taxableValueMinor','') !~ '^[0-9]{1,16}$'
      or coalesce(v_row->>'invoiceValueMinor','0') !~ '^[0-9]{1,16}$'
      or coalesce(v_row->>'igstMinor','0') !~ '^[0-9]{1,16}$'
      or coalesce(v_row->>'cgstMinor','0') !~ '^[0-9]{1,16}$'
      or coalesce(v_row->>'sgstMinor','0') !~ '^[0-9]{1,16}$'
      or coalesce(v_row->>'cessMinor','0') !~ '^[0-9]{1,16}$' then
      raise exception using errcode='22023',message='A GSTR-2B row contains invalid GSTIN, invoice, date or amount data';
    end if;
    v_date:=(v_row->>'invoiceDate')::date;
    if to_char(v_date,'YYYY-MM')>p_return_period then raise exception using errcode='22023',message='Invoice date cannot be after the selected return period'; end if;
    insert into global.gstr2b_import_rows(
      workspace_id,return_period,supplier_gstin,supplier_name,invoice_number,invoice_date,
      invoice_value_minor,taxable_value_minor,igst_minor,cgst_minor,sgst_minor,cess_minor,itc_available,reason,imported_by,imported_at,updated_at
    ) values(
      p_workspace_id,p_return_period,v_gstin,nullif(btrim(v_row->>'supplierName'),''),v_invoice,v_date,
      coalesce((v_row->>'invoiceValueMinor')::bigint,0),(v_row->>'taxableValueMinor')::bigint,
      coalesce((v_row->>'igstMinor')::bigint,0),coalesce((v_row->>'cgstMinor')::bigint,0),
      coalesce((v_row->>'sgstMinor')::bigint,0),coalesce((v_row->>'cessMinor')::bigint,0),
      case when jsonb_typeof(v_row->'itcAvailable')='boolean' then (v_row->>'itcAvailable')::boolean else null end,
      nullif(left(coalesce(v_row->>'reason',''),500),''),p_user_id,now(),now()
    )
    on conflict(workspace_id,return_period,supplier_gstin,invoice_number,invoice_date)
    do update set supplier_name=excluded.supplier_name,invoice_value_minor=excluded.invoice_value_minor,
      taxable_value_minor=excluded.taxable_value_minor,igst_minor=excluded.igst_minor,cgst_minor=excluded.cgst_minor,
      sgst_minor=excluded.sgst_minor,cess_minor=excluded.cess_minor,itc_available=excluded.itc_available,
      reason=excluded.reason,imported_by=excluded.imported_by,imported_at=now(),updated_at=now();
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('ok',true,'imported_rows',v_count,'return_period',p_return_period);
end;
$function$;

create or replace function public.global_list_gstr2b_rows(p_user_id uuid,p_workspace_id uuid,p_return_period text,p_limit integer default 2000)
returns jsonb language plpgsql security definer stable set search_path=pg_catalog,global as $function$
declare v_role text; v_country text; v_rows jsonb;
begin
  if p_user_id is null or p_workspace_id is null or p_return_period is null
    or p_return_period !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_limit<1 or p_limit>2000 then
    raise exception using errcode='22023',message='Invalid GSTR-2B list request';
  end if;
  select m.role,w.country_code into v_role,v_country from global.workspace_members m join global.workspaces w on w.id=m.workspace_id where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.status='active';
  if v_role is null then raise exception using errcode='42501',message='Workspace access denied'; end if;
  if v_country<>'IN' then raise exception using errcode='42501',message='GSTR-2B is available only for India workspaces'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.invoice_date desc,t.invoice_number),'[]'::jsonb) into v_rows
  from (select * from global.gstr2b_import_rows where workspace_id=p_workspace_id and return_period=p_return_period
    order by invoice_date desc,invoice_number limit p_limit) t;
  return jsonb_build_object('ok',true,'records',v_rows);
end;
$function$;

create or replace function public.global_list_purchase_bills(p_user_id uuid,p_workspace_id uuid,p_limit integer default 100)
returns jsonb language plpgsql security definer stable set search_path=pg_catalog,global as $function$
declare v_role text; v_rows jsonb;
begin
  if p_user_id is null or p_workspace_id is null then raise exception using errcode='42501',message='Workspace access denied'; end if;
  select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active';
  if v_role is null then raise exception using errcode='42501',message='Workspace access denied'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.purchase_date desc,t.created_at desc),'[]'::jsonb) into v_rows
  from (select b.*,s.name as supplier_name,s.tax_registration_number as supplier_tax_id
    from global.purchase_bills b join global.suppliers s on s.workspace_id=b.workspace_id and s.id=b.supplier_id
    where b.workspace_id=p_workspace_id order by b.purchase_date desc,b.created_at desc
    limit greatest(1,least(coalesce(p_limit,100),200))) t;
  return jsonb_build_object('ok',true,'purchase_bills',v_rows);
end;
$function$;

create or replace function public.global_save_gst_filing_calendar(
  p_user_id uuid,p_workspace_id uuid,p_return_type text,p_return_period text,p_due_date date,
  p_status text default 'planned',p_filing_reference text default null,p_notes text default null
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,global as $function$
declare v_role text; v_country text; v_row global.gst_filing_calendar%rowtype;
begin
  if p_user_id is null or p_workspace_id is null
    or p_return_type is null or p_return_type not in ('GSTR1','GSTR3B') or p_return_period is null or p_return_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'

    or p_due_date is null or p_status is null or p_status not in ('planned','filed')
    or length(coalesce(p_filing_reference,''))>120 or length(coalesce(p_notes,''))>500 then
    raise exception using errcode='22023',message='Invalid GST filing calendar request';
  end if;
  select m.role,w.country_code into v_role,v_country from global.workspace_members m join global.workspaces w on w.id=m.workspace_id
    where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.status='active';
  if v_role is null then raise exception using errcode='42501',message='Workspace access denied'; end if;
  if v_country<>'IN' then raise exception using errcode='42501',message='GST filing calendar is available only for India workspaces'; end if;
  insert into global.gst_filing_calendar(workspace_id,return_type,return_period,due_date,status,filing_reference,notes,created_by)
  values(p_workspace_id,p_return_type,p_return_period,p_due_date,p_status,nullif(btrim(p_filing_reference),''),nullif(btrim(p_notes),''),p_user_id)
  on conflict(workspace_id,return_type,return_period) do update set due_date=excluded.due_date,status=excluded.status,
    filing_reference=excluded.filing_reference,notes=excluded.notes,updated_at=now()
  returning * into v_row;
  return jsonb_build_object('ok',true,'record',to_jsonb(v_row));
end;
$function$;

create or replace function public.global_list_gst_filing_calendar(p_user_id uuid,p_workspace_id uuid,p_limit integer default 100)
returns jsonb language plpgsql security definer stable set search_path=pg_catalog,global as $function$
declare v_role text; v_country text; v_rows jsonb;
begin
  if p_user_id is null or p_workspace_id is null or p_limit<1 or p_limit>200 then
    raise exception using errcode='22023',message='Invalid GST calendar list request';
  end if;
  select m.role,w.country_code into v_role,v_country from global.workspace_members m join global.workspaces w on w.id=m.workspace_id
    where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.status='active';
  if v_role is null then raise exception using errcode='42501',message='Workspace access denied'; end if;
  if v_country<>'IN' then raise exception using errcode='42501',message='GST filing calendar is available only for India workspaces'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.due_date,t.return_period),'[]'::jsonb) into v_rows
    from (select * from global.gst_filing_calendar where workspace_id=p_workspace_id order by due_date,return_period limit p_limit) t;
  return jsonb_build_object('ok',true,'records',v_rows);
end;
$function$;
revoke all on function public.global_import_gstr2b_rows(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.global_import_gstr2b_rows(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.global_list_gstr2b_rows(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.global_list_gstr2b_rows(uuid,uuid,text,integer) to service_role;
revoke all on function public.global_list_purchase_bills(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.global_list_purchase_bills(uuid,uuid,integer) to service_role;
revoke all on function public.global_save_gst_filing_calendar(uuid,uuid,text,text,date,text,text,text) from public,anon,authenticated;
grant execute on function public.global_save_gst_filing_calendar(uuid,uuid,text,text,date,text,text,text) to service_role;
revoke all on function public.global_list_gst_filing_calendar(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.global_list_gst_filing_calendar(uuid,uuid,integer) to service_role;
commit;
