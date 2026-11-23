-- India-only Main Workspace GSTR-1/GSTR-2B/GSTR-3B preparation and GST calendar.
begin;
create table if not exists public.workspace_gstr1_drafts(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 period_start date not null,period_end date not null,status text not null default 'draft' check(status in ('draft','exported')),
 invoice_count integer not null default 0,b2b_count integer not null default 0,b2c_count integer not null default 0,
 output_tax jsonb not null default '{}'::jsonb,snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),check(period_end>=period_start)
);
create table if not exists public.workspace_gstr2b_imports(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 period_start date not null,period_end date not null,file_name text,import_key uuid not null,imported_rows integer not null default 0,
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,import_key),check(period_end>=period_start)
);
create table if not exists public.workspace_gstr2b_lines(
 id uuid primary key default gen_random_uuid(),workspace_id text not null,import_id uuid not null,
 supplier_gstin text not null check(supplier_gstin ~ '^[0-9A-Z]{15}$'),invoice_number text not null,invoice_date date not null,
 taxable_value numeric(18,4) not null check(taxable_value>=0),cgst numeric(18,4) not null default 0 check(cgst>=0),
 sgst numeric(18,4) not null default 0 check(sgst>=0),igst numeric(18,4) not null default 0 check(igst>=0),
 total_tax numeric(18,4) generated always as (cgst+sgst+igst) stored,
 itc_eligible boolean not null default true,match_status text not null default 'unmatched' check(match_status in ('unmatched','matched','review')),
 matched_expense_id uuid references public.expenses(id) on delete set null,created_at timestamptz not null default now(),
 foreign key(workspace_id,import_id) references public.workspace_gstr2b_imports(workspace_id,id) on delete cascade,
 unique(import_id,supplier_gstin,invoice_number,invoice_date)
);
create table if not exists public.workspace_gstr3b_worksheets(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 period_start date not null,period_end date not null,output_cgst numeric(18,4) not null,output_sgst numeric(18,4) not null,output_igst numeric(18,4) not null,
 itc_cgst numeric(18,4) not null,itc_sgst numeric(18,4) not null,itc_igst numeric(18,4) not null,
 net_cgst numeric(18,4) not null,net_sgst numeric(18,4) not null,net_igst numeric(18,4) not null,
 snapshot jsonb not null,created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),
 unique(workspace_id,id),check(period_end>=period_start)
);
create table if not exists public.workspace_gst_calendar(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 return_type text not null check(return_type in ('GSTR-1','GSTR-3B')),period_start date not null,period_end date not null,due_date date not null,
 status text not null default 'upcoming' check(status in ('upcoming','prepared','filed_manual','overdue')),notes text,created_at timestamptz not null default now(),
 unique(workspace_id,return_type,period_start)
);
create index if not exists workspace_gstr1_period_idx on public.workspace_gstr1_drafts(workspace_id,period_start desc);
create index if not exists workspace_gstr2b_period_idx on public.workspace_gstr2b_imports(workspace_id,period_start desc);
create index if not exists workspace_gstr2b_lines_match_idx on public.workspace_gstr2b_lines(workspace_id,match_status,invoice_date);
create index if not exists workspace_gstr3b_period_idx on public.workspace_gstr3b_worksheets(workspace_id,period_start desc);
create index if not exists workspace_gst_calendar_due_idx on public.workspace_gst_calendar(workspace_id,due_date,status);
do $$ declare t text; begin foreach t in array array['workspace_gstr1_drafts','workspace_gstr2b_imports','workspace_gstr2b_lines','workspace_gstr3b_worksheets','workspace_gst_calendar'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create policy %I on public.%I for all to anon,authenticated using(false) with check(false)',t||'_deny_client_access',t);
end loop;end $$;

create or replace function public.main_workspace_prepare_gstr1_draft(p_workspace_id text,p_period_start date,p_period_end date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_country text;v_currency text;v_snapshot jsonb;v_invoice_count integer;v_b2b integer;v_b2c integer;v_output jsonb;v_id uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select country_code,currency_code into v_country,v_currency from public.workspace_settings where workspace_id=p_workspace_id;
 if upper(coalesce(v_country,''))<>'IN' then return jsonb_build_object('ok',false,'reason','india_workspace_required');end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start or p_period_end>current_date then return jsonb_build_object('ok',false,'reason','invalid_return_period');end if;
 with docs as(select i.id,i.number,i.issue_date,i.client_name,i.client_id,i.currency,i.subtotal,i.cgst,i.sgst,i.igst,i.tax_value,i.total,coalesce(c.gstin,'') gstin
  from public.invoices i left join public.clients c on c.id=i.client_id and c.workspace_id=p_workspace_id
  where i.workspace_id=p_workspace_id and i.issue_date between p_period_start and p_period_end and not i.is_draft and lower(i.status) not in ('draft','cancelled','void')),
 rows as(select jsonb_agg(jsonb_build_object('invoice_number',number,'invoice_date',issue_date,'recipient_name',client_name,'recipient_gstin',nullif(gstin,''),'supply_type',case when gstin ~ '^[0-9A-Z]{15}$' then 'B2B' else 'B2C' end,'invoice_value',total,'taxable_value',subtotal,'cgst',cgst,'sgst',sgst,'igst',igst,'total_tax',tax_value,'currency',currency) order by issue_date,number) data,
 count(*)::int invoice_count,count(*) filter(where gstin ~ '^[0-9A-Z]{15}$')::int b2b_count,count(*) filter(where gstin !~ '^[0-9A-Z]{15}$')::int b2c_count,coalesce(sum(cgst),0) cgst,coalesce(sum(sgst),0) sgst,coalesce(sum(igst),0) igst from docs)
 select coalesce(data,'[]'::jsonb),invoice_count,b2b_count,b2c_count,jsonb_build_object('cgst',cgst,'sgst',sgst,'igst',igst,'total',cgst+sgst+igst) into v_snapshot,v_invoice_count,v_b2b,v_b2c,v_output from rows;
 insert into public.workspace_gstr1_drafts(workspace_id,period_start,period_end,invoice_count,b2b_count,b2c_count,output_tax,snapshot,created_by)
 values(p_workspace_id,p_period_start,p_period_end,v_invoice_count,v_b2b,v_b2c,v_output,jsonb_build_object('currency',v_currency,'invoices',v_snapshot),v_user) returning id into v_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'gst.gstr1_draft_prepared','gstr1_draft',v_id::text,jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'invoice_count',v_invoice_count));
 return jsonb_build_object('ok',true,'draft_id',v_id,'invoice_count',v_invoice_count,'b2b_count',v_b2b,'b2c_count',v_b2c,'output_tax',v_output,'snapshot',jsonb_build_object('currency',v_currency,'invoices',v_snapshot));
end; $function$;

create or replace function public.main_workspace_import_gstr2b(p_workspace_id text,p_period_start date,p_period_end date,p_file_name text,p_rows jsonb,p_import_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_country text;v_import public.workspace_gstr2b_imports%rowtype;v_row jsonb;v_count integer:=0;v_gstin text;v_invoice text;v_date date;v_taxable numeric;v_cgst numeric;v_sgst numeric;v_igst numeric;
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
  v_count:=v_count+1;
 end loop;
 update public.workspace_gstr2b_imports set imported_rows=v_count where id=v_import.id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'gst.gstr2b_imported','gstr2b_import',v_import.id::text,jsonb_build_object('rows',v_count,'period_start',p_period_start,'period_end',p_period_end));
 return jsonb_build_object('ok',true,'import_id',v_import.id,'imported_rows',v_count);
exception when others then if sqlerrm='invalid_gstr2b_line' then return jsonb_build_object('ok',false,'reason',sqlerrm);end if;raise;
end; $function$;

create or replace function public.main_workspace_match_gstr2b_line(p_workspace_id text,p_line_id uuid,p_expense_id uuid,p_itc_eligible boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_line public.workspace_gstr2b_lines%rowtype;v_expense public.expenses%rowtype;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select * into v_line from public.workspace_gstr2b_lines where workspace_id=p_workspace_id and id=p_line_id for update;if not found then return jsonb_build_object('ok',false,'reason','gstr2b_line_not_found');end if;
 if p_expense_id is not null then select * into v_expense from public.expenses where workspace_id=p_workspace_id and id=p_expense_id;if not found or v_expense.currency_code<>'INR' or abs(v_expense.amount-(v_line.taxable_value+v_line.total_tax))>0.01 then return jsonb_build_object('ok',false,'reason','expense_amount_mismatch');end if;end if;
 update public.workspace_gstr2b_lines set matched_expense_id=p_expense_id,match_status=case when p_expense_id is null then 'review' else 'matched' end,itc_eligible=coalesce(p_itc_eligible,false) where id=p_line_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'gst.gstr2b_line_reviewed','gstr2b_line',p_line_id::text,jsonb_build_object('expense_id',p_expense_id,'itc_eligible',p_itc_eligible));
 return jsonb_build_object('ok',true);
end; $function$;

create or replace function public.main_workspace_compute_gstr3b(p_workspace_id text,p_period_start date,p_period_end date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_country text;v_out_cgst numeric;v_out_sgst numeric;v_out_igst numeric;v_itc_cgst numeric;v_itc_sgst numeric;v_itc_igst numeric;v_id uuid;v_snapshot jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select country_code into v_country from public.workspace_settings where workspace_id=p_workspace_id;if upper(coalesce(v_country,''))<>'IN' then return jsonb_build_object('ok',false,'reason','india_workspace_required');end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start then return jsonb_build_object('ok',false,'reason','invalid_return_period');end if;
 select coalesce(sum(cgst),0),coalesce(sum(sgst),0),coalesce(sum(igst),0) into v_out_cgst,v_out_sgst,v_out_igst from public.invoices where workspace_id=p_workspace_id and issue_date between p_period_start and p_period_end and not is_draft and lower(status) not in ('draft','cancelled','void');
 select coalesce(sum(l.cgst),0),coalesce(sum(l.sgst),0),coalesce(sum(l.igst),0) into v_itc_cgst,v_itc_sgst,v_itc_igst from public.workspace_gstr2b_lines l join public.workspace_gstr2b_imports i on i.id=l.import_id where l.workspace_id=p_workspace_id and i.period_start<=p_period_end and i.period_end>=p_period_start and l.match_status='matched' and l.itc_eligible;
 v_snapshot:=jsonb_build_object('output_tax',jsonb_build_object('cgst',v_out_cgst,'sgst',v_out_sgst,'igst',v_out_igst),'eligible_itc',jsonb_build_object('cgst',v_itc_cgst,'sgst',v_itc_sgst,'igst',v_itc_igst),'net_estimate',jsonb_build_object('cgst',greatest(v_out_cgst-v_itc_cgst,0),'sgst',greatest(v_out_sgst-v_itc_sgst,0),'igst',greatest(v_out_igst-v_itc_igst,0)),'itc_carry_forward_estimate',jsonb_build_object('cgst',greatest(v_itc_cgst-v_out_cgst,0),'sgst',greatest(v_itc_sgst-v_out_sgst,0),'igst',greatest(v_itc_igst-v_out_igst,0)));
 insert into public.workspace_gstr3b_worksheets(workspace_id,period_start,period_end,output_cgst,output_sgst,output_igst,itc_cgst,itc_sgst,itc_igst,net_cgst,net_sgst,net_igst,snapshot,created_by)
 values(p_workspace_id,p_period_start,p_period_end,v_out_cgst,v_out_sgst,v_out_igst,v_itc_cgst,v_itc_sgst,v_itc_igst,greatest(v_out_cgst-v_itc_cgst,0),greatest(v_out_sgst-v_itc_sgst,0),greatest(v_out_igst-v_itc_igst,0),v_snapshot,v_user) returning id into v_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'gst.gstr3b_worksheet_prepared','gstr3b_worksheet',v_id::text,jsonb_build_object('period_start',p_period_start,'period_end',p_period_end));
 return jsonb_build_object('ok',true,'worksheet_id',v_id,'snapshot',v_snapshot);
end; $function$;

create or replace function public.main_workspace_generate_gst_calendar(p_workspace_id text,p_period_start date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_country text;v_start date;v_end date;v_next date;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select country_code into v_country from public.workspace_settings where workspace_id=p_workspace_id;if upper(coalesce(v_country,''))<>'IN' then return jsonb_build_object('ok',false,'reason','india_workspace_required');end if;
 if p_period_start is null or date_trunc('month',p_period_start)::date<>p_period_start then return jsonb_build_object('ok',false,'reason','period_must_start_on_first_day');end if;
 v_start:=p_period_start;v_end:=(p_period_start+interval '1 month-1 day')::date;v_next:=(p_period_start+interval '1 month')::date;
 insert into public.workspace_gst_calendar(workspace_id,return_type,period_start,period_end,due_date,notes) values(p_workspace_id,'GSTR-1',v_start,v_end,v_next+10,'Standard monthly due-date estimate; verify current GST notifications.') on conflict(workspace_id,return_type,period_start) do nothing;
 insert into public.workspace_gst_calendar(workspace_id,return_type,period_start,period_end,due_date,notes) values(p_workspace_id,'GSTR-3B',v_start,v_end,v_next+19,'Standard monthly due-date estimate; verify current GST notifications.') on conflict(workspace_id,return_type,period_start) do nothing;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'gst.calendar_generated','gst_calendar',v_start::text,jsonb_build_object('period_end',v_end));
 return jsonb_build_object('ok',true,'period_start',v_start,'period_end',v_end,'gstr1_due',v_next+10,'gstr3b_due',v_next+19);
end; $function$;

create or replace function public.main_workspace_list_gst_compliance(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_country text;v_gstr1 jsonb;v_gstr2b jsonb;v_lines jsonb;v_gstr3b jsonb;v_calendar jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select country_code into v_country from public.workspace_settings where workspace_id=p_workspace_id;if upper(coalesce(v_country,''))<>'IN' then return jsonb_build_object('ok',false,'reason','india_workspace_required');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'period_start',period_start,'period_end',period_end,'status',status,'invoice_count',invoice_count,'b2b_count',b2b_count,'b2c_count',b2c_count,'output_tax',output_tax,'snapshot',snapshot,'created_at',created_at) order by created_at desc),'[]'::jsonb) into v_gstr1 from public.workspace_gstr1_drafts where workspace_id=p_workspace_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'period_start',period_start,'period_end',period_end,'file_name',file_name,'imported_rows',imported_rows,'created_at',created_at) order by created_at desc),'[]'::jsonb) into v_gstr2b from public.workspace_gstr2b_imports where workspace_id=p_workspace_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'import_id',import_id,'supplier_gstin',supplier_gstin,'invoice_number',invoice_number,'invoice_date',invoice_date,'taxable_value',taxable_value,'cgst',cgst,'sgst',sgst,'igst',igst,'total_tax',total_tax,'itc_eligible',itc_eligible,'match_status',match_status,'matched_expense_id',matched_expense_id) order by invoice_date desc),'[]'::jsonb) into v_lines from public.workspace_gstr2b_lines where workspace_id=p_workspace_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'period_start',period_start,'period_end',period_end,'output_cgst',output_cgst,'output_sgst',output_sgst,'output_igst',output_igst,'itc_cgst',itc_cgst,'itc_sgst',itc_sgst,'itc_igst',itc_igst,'net_cgst',net_cgst,'net_sgst',net_sgst,'net_igst',net_igst,'snapshot',snapshot,'created_at',created_at) order by created_at desc),'[]'::jsonb) into v_gstr3b from public.workspace_gstr3b_worksheets where workspace_id=p_workspace_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'return_type',return_type,'period_start',period_start,'period_end',period_end,'due_date',due_date,'status',status,'notes',notes) order by due_date),'[]'::jsonb) into v_calendar from public.workspace_gst_calendar where workspace_id=p_workspace_id;
 return jsonb_build_object('ok',true,'gstr1_drafts',v_gstr1,'gstr2b_imports',v_gstr2b,'gstr2b_lines',v_lines,'gstr3b_worksheets',v_gstr3b,'calendar',v_calendar);
end; $function$;
revoke all on function public.main_workspace_prepare_gstr1_draft(text,date,date) from public,anon;
revoke all on function public.main_workspace_import_gstr2b(text,date,date,text,jsonb,uuid) from public,anon;
revoke all on function public.main_workspace_match_gstr2b_line(text,uuid,uuid,boolean) from public,anon;
revoke all on function public.main_workspace_compute_gstr3b(text,date,date) from public,anon;
revoke all on function public.main_workspace_generate_gst_calendar(text,date) from public,anon;
revoke all on function public.main_workspace_list_gst_compliance(text) from public,anon;
grant execute on function public.main_workspace_prepare_gstr1_draft(text,date,date) to authenticated;
grant execute on function public.main_workspace_import_gstr2b(text,date,date,text,jsonb,uuid) to authenticated;
grant execute on function public.main_workspace_match_gstr2b_line(text,uuid,uuid,boolean) to authenticated;
grant execute on function public.main_workspace_compute_gstr3b(text,date,date) to authenticated;
grant execute on function public.main_workspace_generate_gst_calendar(text,date) to authenticated;
grant execute on function public.main_workspace_list_gst_compliance(text) to authenticated;
commit;
