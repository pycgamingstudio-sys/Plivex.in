-- List private banking, chart of accounts, journal and FX data through authenticated RPCs.
begin;
create or replace function public.main_workspace_list_bank_data(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_accounts jsonb;v_imports jsonb;v_transactions jsonb;v_chart jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'bank_name',bank_name,'account_name',account_name,'account_last4',account_last4,'currency_code',currency_code,'opening_balance',opening_balance,'chart_account_id',chart_account_id) order by created_at desc),'[]'::jsonb) into v_accounts from public.workspace_bank_accounts where workspace_id=p_workspace_id and is_active;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'bank_account_id',i.bank_account_id,'statement_start',i.statement_start,'statement_end',i.statement_end,'opening_balance',i.opening_balance,'closing_balance',i.closing_balance,'currency_code',i.currency_code,'status',i.status,'reconciliation_difference',i.reconciliation_difference,'created_at',i.created_at) order by i.created_at desc),'[]'::jsonb) into v_imports from public.bank_statement_imports i where i.workspace_id=p_workspace_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'import_id',x.import_id,'transaction_date',x.transaction_date,'description',x.description,'reference',x.reference,'amount',x.amount,'direction',x.direction,'currency_code',x.currency_code,'category',x.category,'status',x.status,'matched_invoice_id',x.matched_invoice_id,'matched_expense_id',x.matched_expense_id) order by x.transaction_date desc),'[]'::jsonb)
 into v_transactions from (select * from public.bank_statement_transactions where workspace_id=p_workspace_id order by transaction_date desc limit 250) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'account_type',account_type,'normal_balance',normal_balance) order by code),'[]'::jsonb) into v_chart from public.accounting_accounts where workspace_id=p_workspace_id and is_active;
 return jsonb_build_object('ok',true,'bank_accounts',v_accounts,'imports',v_imports,'transactions',v_transactions,'chart_accounts',v_chart);
end; $function$;
create or replace function public.main_workspace_list_journal_entries(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_rows jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'entry_number',j.entry_number,'entry_date',j.entry_date,'description',j.description,'currency_code',j.currency_code,'status',j.status,'posted_at',j.posted_at,'debits',(select coalesce(sum(l.debit),0) from public.journal_entry_lines l where l.entry_id=j.id),'credits',(select coalesce(sum(l.credit),0) from public.journal_entry_lines l where l.entry_id=j.id),'lines',(select coalesce(jsonb_agg(jsonb_build_object('account_id',l.account_id,'account_name',a.name,'debit',l.debit,'credit',l.credit,'memo',l.memo) order by l.id),'[]'::jsonb) from public.journal_entry_lines l join public.accounting_accounts a on a.id=l.account_id where l.entry_id=j.id)) order by j.entry_date desc,j.created_at desc),'[]'::jsonb)
 into v_rows from (select * from public.journal_entries where workspace_id=p_workspace_id order by entry_date desc,created_at desc limit 100) j;
 return jsonb_build_object('ok',true,'entries',v_rows);
end; $function$;
create or replace function public.main_workspace_list_fx_rates(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_rows jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'from_currency',from_currency,'to_currency',to_currency,'rate',rate,'effective_date',effective_date,'source',source) order by effective_date desc),'[]'::jsonb) into v_rows from public.workspace_fx_rates where workspace_id=p_workspace_id;
 return jsonb_build_object('ok',true,'rates',v_rows);
end; $function$;
revoke all on function public.main_workspace_list_bank_data(text) from public,anon;
revoke all on function public.main_workspace_list_journal_entries(text) from public,anon;
revoke all on function public.main_workspace_list_fx_rates(text) from public,anon;
grant execute on function public.main_workspace_list_bank_data(text) to authenticated;
grant execute on function public.main_workspace_list_journal_entries(text) to authenticated;
grant execute on function public.main_workspace_list_fx_rates(text) to authenticated;
commit;
