-- Count only inserted GSTR-2B rows, prevent future GSTR-3B periods and audit GSTR-1 export.
begin;
create or replace function public.main_workspace_import_gstr2b(p_workspace_id text,p_period_start date,p_period_end date,p_file_name text,p_rows jsonb,p_import_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_country text;v_import public.workspace_gstr2b_imports%rowtype;v_row jsonb;v_count integer:=0;v_inserted integer;v_gstin text;v_invoice text;v_date date;v_taxable numeric;v_cgst numeric;v_sgst numeric;v_igst numeric;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select country_code into v_country from public.workspace_settings where workspace_id=p_workspace_id;if upper(coalesce(v_country,''))<>'IN' then return jsonb_build_object('ok',false,'reason','india_workspace_required');end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>5000 or p_import_key is null then return jsonb_build_object('ok',false,'reason','invalid_gstr2b_import');end if;
 if exists(select 1 from public.workspace_gstr2b_imports where workspace_id=p_workspace_id and import_key=p_import_key) then select * into v_import from public.workspace_gstr2b_imports where workspace_id=p_workspace_id and import_key=p_import_key;return jsonb_build_object('ok',true,'import_id',v_import.id,'duplicate',true);end if;
 insert into public.workspace_gstr2b_imports(workspace_id,period_start,period_end,file_name,import_key,created_by) values(p_workspace_id,p_period_start,p_period_end,left(coalesce(p_file_name,'GSTR2B'),200),p_import_key,v_user) returning * into v_import;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_gstin:=upper(btrim(v_row->>'supplier_gstin'));v_invoice:=btrim(v_row->>'invoice_number');v_date:=(v_row->>'invoice_date')::date;v_taxable:=coalesce((v_row->>'taxable_value')::numeric,0);v_cgst:=coalesce((v_row->>'cgst')::numeric,0);v_sgst:=coalesce((v_row->>'sgst')::numeric,0);v_igst:=coalesce((v_row->>'igst')::numeric,0);
  if v_gstin !~ '^[0-9A-Z]{15}$' or v_invoice='' or v_date is null or v_date<p_period_start or v_date>p_period_end or v_taxable<0 or v_cgst<0 or v_sgst<0 or v_igst<0 then raise exception 'invalid_gstr2b_line';end if;
  insert into public.workspace_gstr2b_lines(workspace_id,import_id,supplier_gstin,invoice_number,invoice_date,taxable_value,cgst,sgst,igst) values(p_workspace_id,v_import.id,v_gstin,left(v_invoice,100),v_date,v_taxable,v_cgst,v_sgst,v_igst) on conflict(import_id,supplier_gstin,invoice_number,invoice_date) do nothing;
  get diagnostics v_inserted=row_count;v_count:=v_count+v_inserted;
 end loop;
 update public.workspace_gstr2b_imports set imported_rows=v_count where id=v_import.id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'gst.gstr2b_imported','gstr2b_import',v_import.id::text,jsonb_build_object('rows',v_count,'period_start',p_period_start,'period_end',p_period_end));
 return jsonb_build_object('ok',true,'import_id',v_import.id,'imported_rows',v_count);
exception when others then if sqlerrm='invalid_gstr2b_line' then return jsonb_build_object('ok',false,'reason',sqlerrm);end if;raise;
end; $function$;
create or replace function public.main_workspace_compute_gstr3b(p_workspace_id text,p_period_start date,p_period_end date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_country text;v_out_cgst numeric;v_out_sgst numeric;v_out_igst numeric;v_itc_cgst numeric;v_itc_sgst numeric;v_itc_igst numeric;v_id uuid;v_snapshot jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select country_code into v_country from public.workspace_settings where workspace_id=p_workspace_id;if upper(coalesce(v_country,''))<>'IN' then return jsonb_build_object('ok',false,'reason','india_workspace_required');end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start or p_period_end>current_date then return jsonb_build_object('ok',false,'reason','invalid_return_period');end if;
 select coalesce(sum(cgst),0),coalesce(sum(sgst),0),coalesce(sum(igst),0) into v_out_cgst,v_out_sgst,v_out_igst from public.invoices where workspace_id=p_workspace_id and issue_date between p_period_start and p_period_end and not is_draft and lower(status) not in ('draft','cancelled','void');
 select coalesce(sum(l.cgst),0),coalesce(sum(l.sgst),0),coalesce(sum(l.igst),0) into v_itc_cgst,v_itc_sgst,v_itc_igst from public.workspace_gstr2b_lines l join public.workspace_gstr2b_imports i on i.id=l.import_id where l.workspace_id=p_workspace_id and i.period_start<=p_period_end and i.period_end>=p_period_start and l.match_status='matched' and l.itc_eligible;
 v_snapshot:=jsonb_build_object('output_tax',jsonb_build_object('cgst',v_out_cgst,'sgst',v_out_sgst,'igst',v_out_igst),'eligible_itc',jsonb_build_object('cgst',v_itc_cgst,'sgst',v_itc_sgst,'igst',v_itc_igst),'net_estimate',jsonb_build_object('cgst',greatest(v_out_cgst-v_itc_cgst,0),'sgst',greatest(v_out_sgst-v_itc_sgst,0),'igst',greatest(v_out_igst-v_itc_igst,0)),'itc_carry_forward_estimate',jsonb_build_object('cgst',greatest(v_itc_cgst-v_out_cgst,0),'sgst',greatest(v_itc_sgst-v_out_sgst,0),'igst',greatest(v_itc_igst-v_out_igst,0)));
 insert into public.workspace_gstr3b_worksheets(workspace_id,period_start,period_end,output_cgst,output_sgst,output_igst,itc_cgst,itc_sgst,itc_igst,net_cgst,net_sgst,net_igst,snapshot,created_by) values(p_workspace_id,p_period_start,p_period_end,v_out_cgst,v_out_sgst,v_out_igst,v_itc_cgst,v_itc_sgst,v_itc_igst,greatest(v_out_cgst-v_itc_cgst,0),greatest(v_out_sgst-v_itc_sgst,0),greatest(v_out_igst-v_itc_igst,0),v_snapshot,v_user) returning id into v_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'gst.gstr3b_worksheet_prepared','gstr3b_worksheet',v_id::text,jsonb_build_object('period_start',p_period_start,'period_end',p_period_end));
 return jsonb_build_object('ok',true,'worksheet_id',v_id,'snapshot',v_snapshot);
end; $function$;
create or replace function public.main_workspace_mark_gstr1_exported(p_workspace_id text,p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_id uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 update public.workspace_gstr1_drafts set status='exported',updated_at=now() where workspace_id=p_workspace_id and id=p_draft_id returning id into v_id;
 if v_id is null then return jsonb_build_object('ok',false,'reason','gstr1_draft_not_found');end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'gst.gstr1_draft_exported','gstr1_draft',v_id::text,'{}'::jsonb);
 return jsonb_build_object('ok',true);
end; $function$;
revoke all on function public.main_workspace_mark_gstr1_exported(text,uuid) from public,anon;
grant execute on function public.main_workspace_mark_gstr1_exported(text,uuid) to authenticated;
commit;
