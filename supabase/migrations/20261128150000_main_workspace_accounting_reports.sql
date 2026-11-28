-- Add base-currency-safe Main Workspace journal posting and core financial reports.
begin;
create or replace function public.main_workspace_create_journal_entry(
  p_workspace_id text,
  p_entry_date date,
  p_description text,
  p_currency_code text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_user uuid:=auth.uid();
  v_id uuid;
  v_existing public.journal_entries%rowtype;
  v_line jsonb;
  v_account uuid;
  v_debit numeric;
  v_credit numeric;
  v_debits numeric:=0;
  v_credits numeric:=0;
  v_count integer:=0;
  v_number text;
  v_fingerprint text;
  v_base_currency text;
begin
  if v_user is null or not public.has_ws_role(
    p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]
  ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if p_entry_date is null
    or length(btrim(coalesce(p_description,''))) not between 2 and 300
    or p_currency_code !~ '^[A-Z]{3}$'
    or p_idempotency_key is null
    or jsonb_typeof(p_lines)<>'array'
    or jsonb_array_length(p_lines)<2
    or jsonb_array_length(p_lines)>100 then
    return jsonb_build_object('ok',false,'reason','invalid_journal_entry');
  end if;

  select currency_code into v_base_currency from public.workspace_settings where workspace_id=p_workspace_id;
  if v_base_currency is null or p_currency_code<>v_base_currency then
    return jsonb_build_object('ok',false,'reason','currency_mismatch');
  end if;

  -- JSONB canonicalizes object key order; the fingerprint binds the key to the
  -- complete submitted request, including the ordered journal lines.
  begin
    select md5(jsonb_build_object(
    'entry_date',p_entry_date,
    'description',btrim(p_description),
    'currency_code',p_currency_code,
    'lines',coalesce(jsonb_agg(jsonb_build_object(
      'account_id',(line.value->>'account_id')::uuid,
      'debit',coalesce((line.value->>'debit')::numeric,0),
      'credit',coalesce((line.value->>'credit')::numeric,0),
      'memo',left(coalesce(line.value->>'memo',''),300)
    ) order by (line.value->>'account_id')::uuid,
      coalesce((line.value->>'debit')::numeric,0),
      coalesce((line.value->>'credit')::numeric,0),
      left(coalesce(line.value->>'memo',''),300)),'[]'::jsonb)
    )::text) into v_fingerprint
    from jsonb_array_elements(p_lines) as line(value);
  exception when others then
    return jsonb_build_object('ok',false,'reason','invalid_journal_entry');
  end;

  -- Serialize same-key requests before checking or inserting the journal.
  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id||':'||p_idempotency_key::text,0
  ));

  select * into v_existing
  from public.journal_entries
  where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key
  for update;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok',true,'entry_id',v_existing.id,'duplicate',true
    );
  end if;

  v_number:='JE-'||to_char(p_entry_date,'YYYYMMDD')||'-'||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));

  insert into public.journal_entries(
    workspace_id,entry_number,entry_date,description,currency_code,
    idempotency_key,request_fingerprint,created_by
  ) values (
    p_workspace_id,v_number,p_entry_date,btrim(p_description),p_currency_code,
    p_idempotency_key,v_fingerprint,v_user
  ) returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_account:=(v_line.value->>'account_id')::uuid;
    v_debit:=coalesce((v_line.value->>'debit')::numeric,0);
    v_credit:=coalesce((v_line.value->>'credit')::numeric,0);

    if v_debit<0 or v_credit<0 or ((v_debit>0)=(v_credit>0))
      or not exists(
        select 1 from public.accounting_accounts
        where id=v_account and workspace_id=p_workspace_id and is_active
      ) then
      raise exception 'invalid_journal_line';
    end if;

    insert into public.journal_entry_lines(
      workspace_id,entry_id,account_id,debit,credit,memo
    ) values (
      p_workspace_id,v_id,v_account,v_debit,v_credit,
      left(coalesce(v_line.value->>'memo',''),300)
    );

    v_debits:=v_debits+v_debit;
    v_credits:=v_credits+v_credit;
    v_count:=v_count+1;
  end loop;

  if v_count<2 or abs(v_debits-v_credits)>=0.0001 then
    raise exception 'journal_not_balanced';
  end if;

  insert into public.workspace_audit_events(
    workspace_id,actor_id,action,entity_type,entity_id,metadata
  ) values (
    p_workspace_id,v_user,'accounting.journal_draft_created',
    'journal_entry',v_id::text,
    jsonb_build_object(
      'entry_number',v_number,'debits',v_debits,'credits',v_credits,
      'currency',p_currency_code,'request_fingerprint',v_fingerprint
    )
  );

  return jsonb_build_object(
    'ok',true,'entry_id',v_id,'entry_number',v_number,'balanced',true
  );
exception
  when others then
    if sqlerrm in ('invalid_journal_line','journal_not_balanced') then
      return jsonb_build_object('ok',false,'reason',sqlerrm);
    end if;
    raise;
end;
$function$;

create or replace function public.main_workspace_trial_balance(
 p_workspace_id text,p_as_of date default current_date
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare
 v_user uuid:=auth.uid();v_currency text;v_rows jsonb;v_debits numeric:=0;v_credits numeric:=0;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then
  return jsonb_build_object('ok',false,'reason','forbidden');
 end if;
 if p_as_of is null then return jsonb_build_object('ok',false,'reason','invalid_date'); end if;
 select currency_code into v_currency from public.workspace_settings where workspace_id=p_workspace_id;
 if v_currency is null then return jsonb_build_object('ok',false,'reason','workspace_not_found'); end if;
 with balances as (
  select a.id,a.code,a.name,a.account_type,a.normal_balance,
   coalesce(sum(l.debit) filter(where j.id is not null),0) as debits,
   coalesce(sum(l.credit) filter(where j.id is not null),0) as credits
  from public.accounting_accounts a
  left join public.journal_entry_lines l on l.workspace_id=p_workspace_id and l.account_id=a.id
  left join public.journal_entries j on j.workspace_id=l.workspace_id and j.id=l.entry_id
   and j.status='posted' and j.currency_code=v_currency and j.entry_date<=p_as_of
  where a.workspace_id=p_workspace_id and a.is_active
  group by a.id,a.code,a.name,a.account_type,a.normal_balance
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'account_id',id,'code',code,'name',name,'account_type',account_type,
   'normal_balance',normal_balance,'debits',debits,'credits',credits,
   'debit_balance',greatest(debits-credits,0),'credit_balance',greatest(credits-debits,0)
  ) order by code),'[]'::jsonb),
  coalesce(sum(greatest(debits-credits,0)),0),
  coalesce(sum(greatest(credits-debits,0)),0)
 into v_rows,v_debits,v_credits from balances;
 return jsonb_build_object('ok',true,'as_of',p_as_of,'currency_code',v_currency,
  'accounts',v_rows,'debit_total',v_debits,'credit_total',v_credits,
  'balanced',abs(v_debits-v_credits)<0.0001);
end;
$function$;

create or replace function public.main_workspace_general_ledger(
 p_workspace_id text,p_account_code text,p_from date,p_to date
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare
 v_user uuid:=auth.uid();v_currency text;v_account public.accounting_accounts%rowtype;
 v_opening numeric:=0;v_rows jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then
  return jsonb_build_object('ok',false,'reason','forbidden');
 end if;
 if nullif(btrim(p_account_code),'') is null or length(p_account_code)>20
  or p_from is null or p_to is null or p_to<p_from then
  return jsonb_build_object('ok',false,'reason','invalid_report_range');
 end if;
 select currency_code into v_currency from public.workspace_settings where workspace_id=p_workspace_id;
 select * into v_account from public.accounting_accounts where workspace_id=p_workspace_id and code=btrim(p_account_code) and is_active;
 if not found then return jsonb_build_object('ok',false,'reason','account_not_found'); end if;
 select coalesce(sum(case when v_account.normal_balance='debit' then l.debit-l.credit else l.credit-l.debit end),0)
 into v_opening
 from public.journal_entry_lines l join public.journal_entries j on j.workspace_id=l.workspace_id and j.id=l.entry_id
 where l.workspace_id=p_workspace_id and l.account_id=v_account.id and j.status='posted'
  and j.currency_code=v_currency and j.entry_date<p_from;
 select coalesce(jsonb_agg(jsonb_build_object(
  'entry_id',q.entry_id,'entry_date',q.entry_date,'entry_number',q.entry_number,
  'description',q.description,'memo',q.memo,'debit',q.debit,'credit',q.credit,
  'running_balance',q.running_balance
 ) order by q.entry_date,q.entry_number,q.line_id),'[]'::jsonb)
 into v_rows
 from (
  select j.id as entry_id,j.entry_date,j.entry_number,j.description,l.memo,l.debit,l.credit,l.id as line_id,
   v_opening+sum(case when v_account.normal_balance='debit' then l.debit-l.credit else l.credit-l.debit end)
    over(order by j.entry_date,j.created_at,j.id,l.id rows between unbounded preceding and current row) as running_balance
  from public.journal_entry_lines l join public.journal_entries j on j.workspace_id=l.workspace_id and j.id=l.entry_id
  where l.workspace_id=p_workspace_id and l.account_id=v_account.id and j.status='posted'
   and j.currency_code=v_currency and j.entry_date between p_from and p_to
 ) q;
 return jsonb_build_object('ok',true,'account',jsonb_build_object('code',v_account.code,'name',v_account.name,
  'normal_balance',v_account.normal_balance),'from',p_from,'to',p_to,'currency_code',v_currency,
  'opening_balance',v_opening,'entries',v_rows);
end;
$function$;

create or replace function public.main_workspace_financial_statements(
 p_workspace_id text,p_from date,p_to date
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare
 v_user uuid:=auth.uid();v_currency text;v_income jsonb;v_expenses jsonb;
 v_assets jsonb;v_liabilities jsonb;v_equity jsonb;
 v_income_total numeric:=0;v_expense_total numeric:=0;v_assets_total numeric:=0;
 v_liabilities_total numeric:=0;v_equity_total numeric:=0;v_profit numeric:=0;v_check numeric:=0;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then
  return jsonb_build_object('ok',false,'reason','forbidden');
 end if;
 if p_from is null or p_to is null or p_to<p_from then return jsonb_build_object('ok',false,'reason','invalid_report_range'); end if;
 select currency_code into v_currency from public.workspace_settings where workspace_id=p_workspace_id;
 if v_currency is null then return jsonb_build_object('ok',false,'reason','workspace_not_found'); end if;

 with balances as (
  select a.id,a.code,a.name,a.account_type,a.normal_balance,
   coalesce(sum(l.debit) filter(where j.id is not null),0) debits,
   coalesce(sum(l.credit) filter(where j.id is not null),0) credits
  from public.accounting_accounts a
  left join public.journal_entry_lines l on l.workspace_id=p_workspace_id and l.account_id=a.id
  left join public.journal_entries j on j.workspace_id=l.workspace_id and j.id=l.entry_id
   and j.status='posted' and j.currency_code=v_currency and j.entry_date between p_from and p_to
  where a.workspace_id=p_workspace_id and a.is_active and lower(a.account_type) in ('income','revenue','expense')
  group by a.id,a.code,a.name,a.account_type,a.normal_balance
 )
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',
   case when normal_balance='credit' then credits-debits else debits-credits end) order by code)
   filter(where lower(account_type) in ('income','revenue')),'[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',
   case when normal_balance='credit' then credits-debits else debits-credits end) order by code)
   filter(where lower(account_type)='expense'),'[]'::jsonb),
  coalesce(sum(case when lower(account_type) in ('income','revenue') then
   case when normal_balance='credit' then credits-debits else debits-credits end else 0 end),0),
  coalesce(sum(case when lower(account_type)='expense' then
   case when normal_balance='credit' then credits-debits else debits-credits end else 0 end),0)
 into v_income,v_expenses,v_income_total,v_expense_total from balances;

 with balances as (
  select a.id,a.code,a.name,a.account_type,a.normal_balance,
   coalesce(sum(l.debit) filter(where j.id is not null),0) debits,
   coalesce(sum(l.credit) filter(where j.id is not null),0) credits
  from public.accounting_accounts a
  left join public.journal_entry_lines l on l.workspace_id=p_workspace_id and l.account_id=a.id
  left join public.journal_entries j on j.workspace_id=l.workspace_id and j.id=l.entry_id
   and j.status='posted' and j.currency_code=v_currency and j.entry_date<=p_to
  where a.workspace_id=p_workspace_id and a.is_active and lower(a.account_type) in ('asset','liability','equity')
  group by a.id,a.code,a.name,a.account_type,a.normal_balance
 )
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',
   case when normal_balance='credit' then credits-debits else debits-credits end) order by code)
   filter(where lower(account_type)='asset'),'[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',
   case when normal_balance='credit' then credits-debits else debits-credits end) order by code)
   filter(where lower(account_type)='liability'),'[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',
   case when normal_balance='credit' then credits-debits else debits-credits end) order by code)
   filter(where lower(account_type)='equity'),'[]'::jsonb),
  coalesce(sum(case when lower(account_type)='asset' then
   case when normal_balance='credit' then credits-debits else debits-credits end else 0 end),0),
  coalesce(sum(case when lower(account_type)='liability' then
   case when normal_balance='credit' then credits-debits else debits-credits end else 0 end),0),
  coalesce(sum(case when lower(account_type)='equity' then
   case when normal_balance='credit' then credits-debits else debits-credits end else 0 end),0)
 into v_assets,v_liabilities,v_equity,v_assets_total,v_liabilities_total,v_equity_total from balances;

 v_profit:=v_income_total-v_expense_total;
 v_check:=v_assets_total-(v_liabilities_total+v_equity_total+v_profit);
 return jsonb_build_object('ok',true,'from',p_from,'to',p_to,'currency_code',v_currency,
  'profit_loss',jsonb_build_object('income',v_income,'expenses',v_expenses,'income_total',v_income_total,
   'expense_total',v_expense_total,'net_profit',v_profit),
  'balance_sheet',jsonb_build_object('assets',v_assets,'liabilities',v_liabilities,'equity',v_equity,
   'current_period_profit',v_profit,'asset_total',v_assets_total,'liability_total',v_liabilities_total,
   'equity_total',v_equity_total,'balance_check',v_check,'balanced',abs(v_check)<0.0001));
end;
$function$;

revoke all on function public.main_workspace_trial_balance(text,date) from public,anon;
revoke all on function public.main_workspace_general_ledger(text,text,date,date) from public,anon;
revoke all on function public.main_workspace_financial_statements(text,date,date) from public,anon;
grant execute on function public.main_workspace_trial_balance(text,date) to authenticated;
grant execute on function public.main_workspace_general_ledger(text,text,date,date) to authenticated;
grant execute on function public.main_workspace_financial_statements(text,date,date) to authenticated;

commit;
