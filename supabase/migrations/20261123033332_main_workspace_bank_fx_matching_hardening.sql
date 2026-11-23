-- Tighten bank-account chart classification, ambiguous matching and reciprocal FX lookups.
begin;
create or replace function public.main_workspace_create_bank_account(p_workspace_id text,p_bank_name text,p_account_name text,p_last4 text,p_currency_code text,p_chart_account_id uuid,p_opening_balance numeric default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_id uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 if p_currency_code !~ '^[A-Z]{3}$' or p_last4 !~ '^[0-9]{4}$' or length(btrim(p_bank_name)) not between 2 and 100 or length(btrim(p_account_name)) not between 2 and 100 or p_opening_balance is null then return jsonb_build_object('ok',false,'reason','invalid_bank_account');end if;
 if not exists(select 1 from public.accounting_accounts where id=p_chart_account_id and workspace_id=p_workspace_id and is_active and account_type='asset') then return jsonb_build_object('ok',false,'reason','asset_chart_account_required');end if;
 insert into public.workspace_bank_accounts(workspace_id,bank_name,account_name,account_last4,currency_code,chart_account_id,opening_balance,created_by) values(p_workspace_id,btrim(p_bank_name),btrim(p_account_name),p_last4,p_currency_code,p_chart_account_id,p_opening_balance,v_user) returning id into v_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'bank.account_created','bank_account',v_id::text,jsonb_build_object('currency_code',p_currency_code,'account_last4',p_last4));
 return jsonb_build_object('ok',true,'bank_account_id',v_id);
end; $function$;
create or replace function public.main_workspace_suggest_bank_matches(p_workspace_id text,p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_tx record;v_match uuid;v_count integer:=0;v_candidates integer;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 for v_tx in select * from public.bank_statement_transactions where workspace_id=p_workspace_id and import_id=p_import_id and status='unmatched' for update loop
  v_match:=null;v_candidates:=0;
  if v_tx.direction='credit' then
   select count(*) into v_candidates from public.invoices where workspace_id=p_workspace_id and currency=v_tx.currency_code and not is_draft and lower(status) not in ('paid','cancelled','draft','void') and abs(total-v_tx.amount)<0.01 and (v_tx.reference is null or number=v_tx.reference);
   if v_candidates=1 then select id into v_match from public.invoices where workspace_id=p_workspace_id and currency=v_tx.currency_code and not is_draft and lower(status) not in ('paid','cancelled','draft','void') and abs(total-v_tx.amount)<0.01 and (v_tx.reference is null or number=v_tx.reference) limit 1;end if;
  else
   select count(*) into v_candidates from public.expenses where workspace_id=p_workspace_id and currency_code=v_tx.currency_code and abs(amount-v_tx.amount)<0.01 and date between v_tx.transaction_date-7 and v_tx.transaction_date+7;
   if v_candidates=1 then select id into v_match from public.expenses where workspace_id=p_workspace_id and currency_code=v_tx.currency_code and abs(amount-v_tx.amount)<0.01 and date between v_tx.transaction_date-7 and v_tx.transaction_date+7 limit 1;end if;
  end if;
  if v_match is not null then update public.bank_statement_transactions set matched_invoice_id=case when v_tx.direction='credit' then v_match else null end,matched_expense_id=case when v_tx.direction='debit' then v_match else null end,status='suggested' where id=v_tx.id;v_count:=v_count+1;end if;
 end loop;
 return jsonb_build_object('ok',true,'suggestions',v_count);
end; $function$;
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
 with balances as(select a.id,a.bank_name,a.account_name,a.currency_code,a.opening_balance+coalesce(sum(case when t.direction='credit' then t.amount else -t.amount end),0) balance from public.workspace_bank_accounts a left join public.bank_statement_imports i on i.bank_account_id=a.id left join public.bank_statement_transactions t on t.import_id=i.id and t.status<>'excluded' where a.workspace_id=p_workspace_id and a.is_active group by a.id),
 converted as(select b.*,case when b.currency_code=v_base then 1 else coalesce((select rate from public.workspace_fx_rates r where r.workspace_id=p_workspace_id and r.from_currency=b.currency_code and r.to_currency=v_base and r.effective_date<=current_date order by r.effective_date desc limit 1),(select 1.0/rate from public.workspace_fx_rates r where r.workspace_id=p_workspace_id and r.from_currency=v_base and r.to_currency=b.currency_code and r.effective_date<=current_date order by r.effective_date desc limit 1)) end fx_rate from balances b)
 select coalesce(jsonb_agg(jsonb_build_object('bank_account_id',id,'bank_name',bank_name,'account_name',account_name,'currency_code',currency_code,'balance',balance,'base_currency',v_base,'fx_rate',fx_rate,'base_equivalent',case when fx_rate is null then null else round(balance*fx_rate,4) end,'rate_missing',fx_rate is null) order by currency_code,bank_name),'[]'::jsonb) into v_rows from converted;
 return jsonb_build_object('ok',true,'base_currency',v_base,'accounts',v_rows);
end; $function$;
commit;
