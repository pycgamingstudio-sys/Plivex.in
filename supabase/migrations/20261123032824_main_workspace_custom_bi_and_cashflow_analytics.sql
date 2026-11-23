-- Main Workspace saved custom reports, sales analytics and currency-safe rule-based cash-flow forecast.
begin;
create table if not exists public.workspace_custom_reports(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 report_name text not null check(length(btrim(report_name)) between 2 and 100),metrics text[] not null check(cardinality(metrics) between 1 and 6),
 group_by text not null check(group_by in ('month','category','stage')),date_window_days integer not null default 90 check(date_window_days in (30,90,180,365)),
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,id)
);
alter table public.workspace_custom_reports enable row level security;
revoke all on public.workspace_custom_reports from public,anon,authenticated;
grant all on public.workspace_custom_reports to service_role;
create policy workspace_custom_reports_deny_client_access on public.workspace_custom_reports for all to anon,authenticated using(false) with check(false);
create index if not exists workspace_custom_reports_workspace_idx on public.workspace_custom_reports(workspace_id,created_at desc);

create or replace function public.main_workspace_save_custom_report(p_workspace_id text,p_report_name text,p_metrics text[],p_group_by text,p_date_window_days integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_id uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 if length(btrim(coalesce(p_report_name,''))) not between 2 and 100 or p_metrics is null or cardinality(p_metrics) not between 1 and 6 or p_metrics <@ array['invoice_count','invoice_total','expense_total','lead_count','lead_value','low_stock_count']::text[] or p_group_by not in ('month','category','stage') or p_date_window_days not in (30,90,180,365) then return jsonb_build_object('ok',false,'reason','invalid_report_config');end if;
 insert into public.workspace_custom_reports(workspace_id,report_name,metrics,group_by,date_window_days,created_by) values(p_workspace_id,btrim(p_report_name),p_metrics,p_group_by,p_date_window_days,v_user) returning id into v_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'bi.custom_report_saved','custom_report',v_id::text,jsonb_build_object('metrics',p_metrics,'group_by',p_group_by,'date_window_days',p_date_window_days));
 return jsonb_build_object('ok',true,'report_id',v_id);
end; $function$;
create or replace function public.main_workspace_list_custom_reports(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_rows jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'report_name',report_name,'metrics',metrics,'group_by',group_by,'date_window_days',date_window_days,'created_at',created_at) order by created_at desc),'[]'::jsonb) into v_rows from public.workspace_custom_reports where workspace_id=p_workspace_id;
 return jsonb_build_object('ok',true,'reports',v_rows);
end; $function$;
create or replace function public.main_workspace_delete_custom_report(p_workspace_id text,p_report_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_id uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 delete from public.workspace_custom_reports where workspace_id=p_workspace_id and id=p_report_id returning id into v_id;
 if v_id is null then return jsonb_build_object('ok',false,'reason','report_not_found');end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'bi.custom_report_deleted','custom_report',v_id::text,'{}'::jsonb);
 return jsonb_build_object('ok',true);
end; $function$;
create or replace function public.main_workspace_cashflow_forecast(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_rows jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 with months as(select (date_trunc('month',current_date)::date+(g.n||' months')::interval)::date month_start from generate_series(0,2) g(n)),
 currencies as(select distinct currency from public.invoices where workspace_id=p_workspace_id union select distinct currency_code from public.expenses where workspace_id=p_workspace_id),
 receipts as(select currency,date_trunc('month',greatest(coalesce(due_date,issue_date+30),current_date))::date month_start,sum(total) amount from public.invoices where workspace_id=p_workspace_id and not is_draft and lower(status) not in ('draft','cancelled','void','paid') and greatest(coalesce(due_date,issue_date+30),current_date)<date_trunc('month',current_date)+interval '3 months' group by currency,date_trunc('month',greatest(coalesce(due_date,issue_date+30),current_date))::date),
 expense_avg as(select currency_code,sum(amount)/3.0 monthly_expenses from public.expenses where workspace_id=p_workspace_id and date>=current_date-interval '3 months' and lower(coalesce(status,''))<>'cancelled' group by currency_code)
 select coalesce(jsonb_agg(jsonb_build_object('month',m.month_start,'currency',c.currency,'expected_receivables',coalesce(r.amount,0),'projected_expenses',coalesce(e.monthly_expenses,0),'projected_net',coalesce(r.amount,0)-coalesce(e.monthly_expenses,0)) order by m.month_start,c.currency),'[]'::jsonb) into v_rows
 from months m cross join currencies c left join receipts r on r.month_start=m.month_start and r.currency=c.currency left join expense_avg e on e.currency_code=c.currency;
 return jsonb_build_object('ok',true,'forecast',v_rows,'method','Rule-based estimate: unpaid invoice totals by due month and trailing three-month average expenses; currencies are kept separate and partial receipts are not netted.');
end; $function$;
create or replace function public.main_workspace_sales_analytics(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_rows jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select coalesce(jsonb_agg(jsonb_build_object('month',x.month_start,'currency',x.currency,'invoice_count',x.invoice_count,'sales_total',x.sales_total,'paid_count',x.paid_count,'open_count',x.open_count) order by x.month_start,x.currency),'[]'::jsonb) into v_rows
 from(select date_trunc('month',issue_date)::date month_start,currency,count(*) invoice_count,sum(total) sales_total,count(*) filter(where lower(status)='paid') paid_count,count(*) filter(where lower(status) not in ('paid','cancelled','draft','void')) open_count from public.invoices where workspace_id=p_workspace_id and not is_draft and issue_date>=current_date-interval '6 months' group by date_trunc('month',issue_date)::date,currency)x;
 return jsonb_build_object('ok',true,'sales',v_rows);
end; $function$;
revoke all on function public.main_workspace_save_custom_report(text,text,text[],text,integer) from public,anon;
revoke all on function public.main_workspace_list_custom_reports(text) from public,anon;
revoke all on function public.main_workspace_delete_custom_report(text,uuid) from public,anon;
revoke all on function public.main_workspace_cashflow_forecast(text) from public,anon;
revoke all on function public.main_workspace_sales_analytics(text) from public,anon;
grant execute on function public.main_workspace_save_custom_report(text,text,text[],text,integer) to authenticated;
grant execute on function public.main_workspace_list_custom_reports(text) to authenticated;
grant execute on function public.main_workspace_delete_custom_report(text,uuid) to authenticated;
grant execute on function public.main_workspace_cashflow_forecast(text) to authenticated;
grant execute on function public.main_workspace_sales_analytics(text) to authenticated;
commit;
