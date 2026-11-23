-- Dated FX conversion and reconciliation; foreign balances are never silently mixed.
begin;
create or replace function public.main_workspace_convert_amount(p_workspace_id text,p_amount numeric,p_from_currency text,p_to_currency text,p_on_date date default current_date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_rate numeric;v_date date;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 if p_amount is null or p_from_currency !~ '^[A-Z]{3}$' or p_to_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('ok',false,'reason','invalid_conversion');end if;
 if p_from_currency=p_to_currency then return jsonb_build_object('ok',true,'rate',1,'converted_amount',p_amount,'rate_date',p_on_date);end if;
 select rate,effective_date into v_rate,v_date from public.workspace_fx_rates where workspace_id=p_workspace_id and from_currency=p_from_currency and to_currency=p_to_currency and effective_date<=coalesce(p_on_date,current_date) order by effective_date desc limit 1;
 if v_rate is null then select 1.0/rate,effective_date into v_rate,v_date from public.workspace_fx_rates where workspace_id=p_workspace_id and from_currency=p_to_currency and to_currency=p_from_currency and effective_date<=coalesce(p_on_date,current_date) order by effective_date desc limit 1;end if;
 if v_rate is null then return jsonb_build_object('ok',false,'reason','fx_rate_not_found');end if;
 return jsonb_build_object('ok',true,'rate',v_rate,'converted_amount',round(p_amount*v_rate,4),'rate_date',v_date);
end; $function$;
create or replace function public.main_workspace_fx_reconciliation(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_base text;v_rows jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select currency_code into v_base from public.workspace_settings where workspace_id=p_workspace_id;
 with balances as(select a.id,a.bank_name,a.account_name,a.currency_code,a.opening_balance+coalesce(sum(case when t.direction='credit' then t.amount else -t.amount end),0) balance
  from public.workspace_bank_accounts a left join public.bank_statement_imports i on i.bank_account_id=a.id left join public.bank_statement_transactions t on t.import_id=i.id and t.status<>'excluded'
  where a.workspace_id=p_workspace_id and a.is_active group by a.id),
 converted as(select b.*,case when b.currency_code=v_base then 1 else coalesce(
  (select rate from public.workspace_fx_rates r where r.workspace_id=p_workspace_id and r.from_currency=b.currency_code and r.to_currency=v_base and r.effective_date<=current_date order by r.effective_date desc limit 1),
  (select 1.0/rate from public.workspace_fx_rates r where r.workspace_id=p_workspace_id and r.from_currency=v_base and r.to_currency=b.currency_code and r.effective_date<=current_date order by r.effective_date desc limit 1)
 ) end fx_rate from balances b)
 select coalesce(jsonb_agg(jsonb_build_object('bank_account_id',id,'bank_name',bank_name,'account_name',account_name,'currency_code',currency_code,'balance',balance,'base_currency',v_base,'fx_rate',fx_rate,'base_equivalent',case when fx_rate is null then null else round(balance*fx_rate,4) end,'rate_missing',fx_rate is null) order by currency_code,bank_name),'[]'::jsonb) into v_rows from converted;
 return jsonb_build_object('ok',true,'base_currency',v_base,'accounts',v_rows);
end; $function$;
revoke all on function public.main_workspace_convert_amount(text,numeric,text,text,date) from public,anon;
revoke all on function public.main_workspace_fx_reconciliation(text) from public,anon;
grant execute on function public.main_workspace_convert_amount(text,numeric,text,text,date) to authenticated;
grant execute on function public.main_workspace_fx_reconciliation(text) to authenticated;
commit;
