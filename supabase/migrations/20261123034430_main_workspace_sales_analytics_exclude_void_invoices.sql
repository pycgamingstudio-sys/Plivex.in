-- Exclude cancelled and void invoices from six-month sales analytics.
create or replace function public.main_workspace_sales_analytics(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_rows jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select coalesce(jsonb_agg(jsonb_build_object('month',x.month_start,'currency',x.currency,'invoice_count',x.invoice_count,'sales_total',x.sales_total,'paid_count',x.paid_count,'open_count',x.open_count) order by x.month_start,x.currency),'[]'::jsonb) into v_rows
 from(select date_trunc('month',issue_date)::date month_start,currency,count(*) invoice_count,sum(total) sales_total,
 count(*) filter(where lower(status)='paid') paid_count,count(*) filter(where lower(status) not in ('paid','cancelled','draft','void')) open_count
 from public.invoices where workspace_id=p_workspace_id and not is_draft and lower(status) not in ('cancelled','draft','void') and issue_date>=current_date-interval '6 months'
 group by date_trunc('month',issue_date)::date,currency)x;
 return jsonb_build_object('ok',true,'sales',v_rows);
end; $function$;
