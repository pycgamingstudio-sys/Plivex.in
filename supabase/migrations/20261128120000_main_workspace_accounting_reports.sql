-- Main Workspace accounting reports.
-- All results remain grouped by transaction currency; no implicit FX conversion is performed.
begin;

create index if not exists journal_entries_workspace_status_date_idx
  on public.journal_entries(workspace_id,status,entry_date);
create index if not exists journal_lines_workspace_account_entry_idx
  on public.journal_entry_lines(workspace_id,entry_id,account_id);

create or replace function public.main_workspace_accounting_summary(
  p_workspace_id text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_user uuid:=auth.uid();
  v_trial_balance jsonb;
  v_income_statement jsonb;
  v_balance_sheet jsonb;
  v_cash_bank_movement jsonb;
begin
  if v_user is null or not public.has_ws_role(
    p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]
  ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if p_from is null or p_to is null or p_from>p_to then
    return jsonb_build_object('ok',false,'reason','invalid_reporting_period');
  end if;

  -- Trial balance is cumulative through the report end date and keeps each
  -- transaction currency separate so unlike currencies are never added.
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id',x.account_id,
    'code',x.code,
    'name',x.name,
    'account_type',x.account_type,
    'normal_balance',x.normal_balance,
    'currency_code',x.currency_code,
    'debit_total',x.debit_total,
    'credit_total',x.credit_total,
    'debit_balance',greatest(x.debit_total-x.credit_total,0),
    'credit_balance',greatest(x.credit_total-x.debit_total,0)
  ) order by x.currency_code,x.code),'[]'::jsonb)
  into v_trial_balance
  from (
    select a.id as account_id,a.code,a.name,a.account_type,a.normal_balance,
      j.currency_code,
      coalesce(sum(l.debit),0)::numeric(20,4) as debit_total,
      coalesce(sum(l.credit),0)::numeric(20,4) as credit_total
    from public.accounting_accounts a
    join public.journal_entry_lines l
      on l.workspace_id=a.workspace_id and l.account_id=a.id
    join public.journal_entries j
      on j.workspace_id=l.workspace_id and j.id=l.entry_id
    where a.workspace_id=p_workspace_id
      and j.status='posted'
      and j.entry_date<=p_to
    group by a.id,a.code,a.name,a.account_type,a.normal_balance,j.currency_code
  ) x;

  -- Period P&L is grouped by currency and uses posted entries only.
  select coalesce(jsonb_agg(jsonb_build_object(
    'currency_code',x.currency_code,
    'revenue',x.revenue,
    'expenses',x.expenses,
    'net_profit',x.revenue-x.expenses
  ) order by x.currency_code),'[]'::jsonb)
  into v_income_statement
  from (
    select j.currency_code,
      coalesce(sum(l.credit-l.debit) filter(where a.account_type='revenue'),0)::numeric(20,4) as revenue,
      coalesce(sum(l.debit-l.credit) filter(where a.account_type='expense'),0)::numeric(20,4) as expenses
    from public.journal_entries j
    join public.journal_entry_lines l
      on l.workspace_id=j.workspace_id and l.entry_id=j.id
    join public.accounting_accounts a
      on a.workspace_id=l.workspace_id and a.id=l.account_id
    where j.workspace_id=p_workspace_id
      and j.status='posted'
      and j.entry_date between p_from and p_to
    group by j.currency_code
  ) x;

  -- Balance sheet is cumulative through p_to. Current-period earnings are
  -- included in equity until a formal year-end close transfers them to retained earnings.
  select coalesce(jsonb_agg(jsonb_build_object(
    'currency_code',x.currency_code,
    'assets',x.assets,
    'liabilities',x.liabilities,
    'equity',x.equity,
    'current_earnings',x.current_earnings,
    'total_equity',x.equity+x.current_earnings,
    'balance_difference',x.assets-(x.liabilities+x.equity+x.current_earnings)
  ) order by x.currency_code),'[]'::jsonb)
  into v_balance_sheet
  from (
    select j.currency_code,
      coalesce(sum(l.debit-l.credit) filter(where a.account_type='asset'),0)::numeric(20,4) as assets,
      coalesce(sum(l.credit-l.debit) filter(where a.account_type='liability'),0)::numeric(20,4) as liabilities,
      coalesce(sum(l.credit-l.debit) filter(where a.account_type='equity'),0)::numeric(20,4) as equity,
      (
        coalesce(sum(l.credit-l.debit) filter(where a.account_type='revenue'),0)
        - coalesce(sum(l.debit-l.credit) filter(where a.account_type='expense'),0)
      )::numeric(20,4) as current_earnings
    from public.journal_entries j
    join public.journal_entry_lines l
      on l.workspace_id=j.workspace_id and l.entry_id=j.id
    join public.accounting_accounts a
      on a.workspace_id=l.workspace_id and a.id=l.account_id
    where j.workspace_id=p_workspace_id
      and j.status='posted'
      and j.entry_date<=p_to
    group by j.currency_code
  ) x;

  -- This is the movement in the seeded cash and bank control accounts, not a
  -- full indirect cash-flow statement. It is kept distinct in the UI.
  select coalesce(jsonb_agg(jsonb_build_object(
    'currency_code',x.currency_code,
    'cash_bank_increase',x.cash_bank_increase
  ) order by x.currency_code),'[]'::jsonb)
  into v_cash_bank_movement
  from (
    select j.currency_code,
      coalesce(sum(l.debit-l.credit),0)::numeric(20,4) as cash_bank_increase
    from public.journal_entries j
    join public.journal_entry_lines l
      on l.workspace_id=j.workspace_id and l.entry_id=j.id
    join public.accounting_accounts a
      on a.workspace_id=l.workspace_id and a.id=l.account_id
    where j.workspace_id=p_workspace_id
      and j.status='posted'
      and j.entry_date between p_from and p_to
      and a.code in ('1000','1010')
    group by j.currency_code
  ) x;

  return jsonb_build_object(
    'ok',true,
    'period',jsonb_build_object('from',p_from,'to',p_to),
    'trial_balance',v_trial_balance,
    'income_statement',v_income_statement,
    'balance_sheet',v_balance_sheet,
    'cash_bank_movement',v_cash_bank_movement
  );
end;
$function$;

revoke all on function public.main_workspace_accounting_summary(text,date,date) from public,anon;
grant execute on function public.main_workspace_accounting_summary(text,date,date) to authenticated;

commit;
