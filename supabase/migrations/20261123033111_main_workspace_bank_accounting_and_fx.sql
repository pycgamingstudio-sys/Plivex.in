-- Main Workspace CSV banking, reconciliation, double-entry ledger and dated FX rates.
begin;
create table if not exists public.workspace_bank_accounts(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 bank_name text not null,account_name text not null,account_last4 text not null check(account_last4 ~ '^[0-9]{4}$'),
 currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),chart_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
 opening_balance numeric(18,4) not null default 0,is_active boolean not null default true,created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,id)
);
create table if not exists public.bank_statement_imports(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 bank_account_id uuid not null references public.workspace_bank_accounts(id) on delete restrict,statement_start date,statement_end date,
 opening_balance numeric(18,4) not null,closing_balance numeric(18,4) not null,currency_code text not null,
 status text not null default 'imported' check(status in ('imported','reviewed','reconciled','needs_review')),
 reconciliation_difference numeric(18,4),idempotency_key uuid not null,created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),unique(workspace_id,id),unique(workspace_id,idempotency_key)
);
create table if not exists public.bank_statement_transactions(
 id uuid primary key default gen_random_uuid(),workspace_id text not null,import_id uuid not null,
 transaction_date date not null,description text not null,reference text,amount numeric(18,4) not null check(amount>0),
 direction text not null check(direction in ('debit','credit')),currency_code text not null,category text,
 status text not null default 'unmatched' check(status in ('unmatched','suggested','matched','excluded')),
 matched_invoice_id uuid references public.invoices(id) on delete set null,matched_expense_id uuid references public.expenses(id) on delete set null,
 row_key text not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,import_id) references public.bank_statement_imports(workspace_id,id) on delete cascade,unique(import_id,row_key)
);
create table if not exists public.workspace_fx_rates(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 from_currency text not null check(from_currency ~ '^[A-Z]{3}$'),to_currency text not null check(to_currency ~ '^[A-Z]{3}$'),
 rate numeric(20,10) not null check(rate>0),effective_date date not null,source text not null default 'manual',
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),
 unique(workspace_id,from_currency,to_currency,effective_date),check(from_currency<>to_currency)
);
create table if not exists public.journal_entries(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 entry_number text not null,entry_date date not null,description text not null,currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),
 source_type text,source_id text,status text not null default 'draft' check(status in ('draft','posted','void')),
 idempotency_key uuid not null,created_by uuid not null references auth.users(id) on delete restrict,posted_by uuid references auth.users(id) on delete set null,
 posted_at timestamptz,created_at timestamptz not null default now(),unique(workspace_id,id),unique(workspace_id,entry_number),unique(workspace_id,idempotency_key)
);
create table if not exists public.journal_entry_lines(
 id uuid primary key default gen_random_uuid(),workspace_id text not null,entry_id uuid not null,
 account_id uuid not null references public.accounting_accounts(id) on delete restrict,debit numeric(18,4) not null default 0 check(debit>=0),
 credit numeric(18,4) not null default 0 check(credit>=0),memo text,created_at timestamptz not null default now(),
 foreign key(workspace_id,entry_id) references public.journal_entries(workspace_id,id) on delete cascade,
 check((debit>0 and credit=0) or (credit>0 and debit=0))
);
create index if not exists bank_transactions_import_idx on public.bank_statement_transactions(workspace_id,import_id,status);
create index if not exists journal_entries_workspace_idx on public.journal_entries(workspace_id,entry_date desc);
create index if not exists journal_lines_entry_idx on public.journal_entry_lines(workspace_id,entry_id);
do $$ declare t text; begin
 foreach t in array array['workspace_bank_accounts','bank_statement_imports','bank_statement_transactions','workspace_fx_rates','journal_entries','journal_entry_lines'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy %I on public.%I for all to anon,authenticated using(false) with check(false)',t||'_deny_client_access',t);
 end loop;
end $$;

create or replace function public.main_workspace_create_bank_account(p_workspace_id text,p_bank_name text,p_account_name text,p_last4 text,p_currency_code text,p_chart_account_id uuid,p_opening_balance numeric default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_id uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 if p_currency_code !~ '^[A-Z]{3}$' or p_last4 !~ '^[0-9]{4}$' or length(btrim(p_bank_name)) not between 2 and 100 or length(btrim(p_account_name)) not between 2 and 100 or p_opening_balance is null then return jsonb_build_object('ok',false,'reason','invalid_bank_account');end if;
 if not exists(select 1 from public.accounting_accounts where id=p_chart_account_id and workspace_id=p_workspace_id and is_active and account_type='asset') then return jsonb_build_object('ok',false,'reason','asset_chart_account_required');end if;
 insert into public.workspace_bank_accounts(workspace_id,bank_name,account_name,account_last4,currency_code,chart_account_id,opening_balance,created_by)
 values(p_workspace_id,btrim(p_bank_name),btrim(p_account_name),p_last4,p_currency_code,p_chart_account_id,p_opening_balance,v_user) returning id into v_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'bank.account_created','bank_account',v_id::text,jsonb_build_object('currency_code',p_currency_code,'account_last4',p_last4));
 return jsonb_build_object('ok',true,'bank_account_id',v_id);
end; $function$;

create or replace function public.main_workspace_import_bank_statement(p_workspace_id text,p_bank_account_id uuid,p_rows jsonb,p_opening_balance numeric,p_closing_balance numeric,p_start date,p_end date,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_account public.workspace_bank_accounts%rowtype;v_import public.bank_statement_imports%rowtype;v_row jsonb;v_date date;v_amount numeric;v_direction text;v_desc text;v_ref text;v_idx integer:=0;v_count integer:=0;v_key text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>5000 or p_idempotency_key is null or p_opening_balance is null or p_closing_balance is null then return jsonb_build_object('ok',false,'reason','invalid_statement');end if;
 select * into v_account from public.workspace_bank_accounts where workspace_id=p_workspace_id and id=p_bank_account_id and is_active;
 if not found then return jsonb_build_object('ok',false,'reason','bank_account_not_found');end if;
 if exists(select 1 from public.bank_statement_imports where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key) then select * into v_import from public.bank_statement_imports where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;return jsonb_build_object('ok',true,'import_id',v_import.id,'duplicate',true);end if;
 insert into public.bank_statement_imports(workspace_id,bank_account_id,statement_start,statement_end,opening_balance,closing_balance,currency_code,idempotency_key,created_by)
 values(p_workspace_id,p_bank_account_id,p_start,p_end,p_opening_balance,p_closing_balance,v_account.currency_code,p_idempotency_key,v_user) returning * into v_import;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_idx:=v_idx+1;v_date:=(v_row->>'date')::date;v_amount:=coalesce((v_row->>'amount')::numeric,0);v_direction:=lower(v_row->>'direction');v_desc:=nullif(btrim(v_row->>'description'),'');v_ref:=nullif(btrim(v_row->>'reference'),'');
  if v_date is null or v_amount<=0 or v_direction not in ('debit','credit') or v_desc is null or length(v_desc)>500 then raise exception 'invalid_bank_transaction_row';end if;
  v_key:=md5(v_idx::text||'|'||v_date::text||'|'||v_amount::text||'|'||v_direction||'|'||coalesce(v_ref,'')||'|'||v_desc);
  insert into public.bank_statement_transactions(workspace_id,import_id,transaction_date,description,reference,amount,direction,currency_code,category,row_key)
  values(p_workspace_id,v_import.id,v_date,v_desc,v_ref,v_amount,v_direction,v_account.currency_code,
   case when v_desc ~* '(rent|lease)' then 'Rent' when v_desc ~* '(salary|payroll)' then 'Salary' when v_desc ~* '(fuel|petrol|diesel)' then 'Fuel' when v_desc ~* '(electric|water|utility)' then 'Utilities' when v_desc ~* '(tax|gst|vat)' then 'Tax' when v_desc ~* '(software|subscription|cloud)' then 'Software' when v_direction='credit' then 'Customer receipt' else 'Uncategorised' end,v_key);
  v_count:=v_count+1;
 end loop;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'bank.statement_imported','bank_statement_import',v_import.id::text,jsonb_build_object('rows',v_count,'currency_code',v_account.currency_code));
 return jsonb_build_object('ok',true,'import_id',v_import.id,'transaction_count',v_count);
exception when others then if sqlerrm='invalid_bank_transaction_row' then return jsonb_build_object('ok',false,'reason',sqlerrm);end if;raise;
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

create or replace function public.main_workspace_confirm_bank_match(p_workspace_id text,p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_tx public.bank_statement_transactions%rowtype;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select * into v_tx from public.bank_statement_transactions where workspace_id=p_workspace_id and id=p_transaction_id and status='suggested' for update;
 if not found then return jsonb_build_object('ok',false,'reason','match_suggestion_not_found');end if;
 update public.bank_statement_transactions set status='matched' where id=p_transaction_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'bank.transaction_matched','bank_statement_transaction',p_transaction_id::text,jsonb_build_object('invoice_id',v_tx.matched_invoice_id,'expense_id',v_tx.matched_expense_id));
 return jsonb_build_object('ok',true);
end; $function$;

create or replace function public.main_workspace_reconcile_bank_import(p_workspace_id text,p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_import public.bank_statement_imports%rowtype;v_credits numeric;v_debits numeric;v_expected numeric;v_diff numeric;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 select * into v_import from public.bank_statement_imports where workspace_id=p_workspace_id and id=p_import_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','import_not_found');end if;
 select coalesce(sum(amount) filter(where direction='credit'),0),coalesce(sum(amount) filter(where direction='debit'),0) into v_credits,v_debits from public.bank_statement_transactions where import_id=p_import_id and status<>'excluded';
 v_expected:=v_import.opening_balance+v_credits-v_debits;v_diff:=v_import.closing_balance-v_expected;
 update public.bank_statement_imports set reconciliation_difference=v_diff,status=case when abs(v_diff)<0.01 then 'reconciled' else 'needs_review' end where id=p_import_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'bank.statement_reconciled','bank_statement_import',p_import_id::text,jsonb_build_object('difference',v_diff,'expected_closing',v_expected));
 return jsonb_build_object('ok',true,'difference',v_diff,'expected_closing',v_expected,'status',case when abs(v_diff)<0.01 then 'reconciled' else 'needs_review' end);
end; $function$;

create or replace function public.main_workspace_save_fx_rate(p_workspace_id text,p_from_currency text,p_to_currency text,p_rate numeric,p_effective_date date,p_source text default 'manual')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_id uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 if p_from_currency !~ '^[A-Z]{3}$' or p_to_currency !~ '^[A-Z]{3}$' or p_from_currency=p_to_currency or p_rate is null or p_rate<=0 or p_effective_date is null then return jsonb_build_object('ok',false,'reason','invalid_fx_rate');end if;
 insert into public.workspace_fx_rates(workspace_id,from_currency,to_currency,rate,effective_date,source,created_by) values(p_workspace_id,p_from_currency,p_to_currency,p_rate,p_effective_date,left(coalesce(p_source,'manual'),80),v_user)
 on conflict(workspace_id,from_currency,to_currency,effective_date) do update set rate=excluded.rate,source=excluded.source returning id into v_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'fx.rate_saved','fx_rate',v_id::text,jsonb_build_object('from',p_from_currency,'to',p_to_currency,'rate',p_rate,'date',p_effective_date));
 return jsonb_build_object('ok',true,'rate_id',v_id);
end; $function$;

create or replace function public.main_workspace_create_journal_entry(p_workspace_id text,p_entry_date date,p_description text,p_currency_code text,p_lines jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_id uuid;v_line jsonb;v_account uuid;v_debit numeric;v_credit numeric;v_debits numeric:=0;v_credits numeric:=0;v_count integer:=0;v_number text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 if p_entry_date is null or length(btrim(coalesce(p_description,''))) not between 2 and 300 or p_currency_code !~ '^[A-Z]{3}$' or p_idempotency_key is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 or jsonb_array_length(p_lines)>100 then return jsonb_build_object('ok',false,'reason','invalid_journal_entry');end if;
 if exists(select 1 from public.journal_entries where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key) then select id into v_id from public.journal_entries where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;return jsonb_build_object('ok',true,'entry_id',v_id,'duplicate',true);end if;
 v_number:='JE-'||to_char(p_entry_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.journal_entries(workspace_id,entry_number,entry_date,description,currency_code,idempotency_key,created_by) values(p_workspace_id,v_number,p_entry_date,btrim(p_description),p_currency_code,p_idempotency_key,v_user) returning id into v_id;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_account:=(v_line->>'account_id')::uuid;v_debit:=coalesce((v_line->>'debit')::numeric,0);v_credit:=coalesce((v_line->>'credit')::numeric,0);
  if v_debit<0 or v_credit<0 or ((v_debit>0)=(v_credit>0)) or not exists(select 1 from public.accounting_accounts where id=v_account and workspace_id=p_workspace_id and is_active) then raise exception 'invalid_journal_line';end if;
  insert into public.journal_entry_lines(workspace_id,entry_id,account_id,debit,credit,memo) values(p_workspace_id,v_id,v_account,v_debit,v_credit,left(coalesce(v_line->>'memo',''),300));
  v_debits:=v_debits+v_debit;v_credits:=v_credits+v_credit;v_count:=v_count+1;
 end loop;
 if v_count<2 or abs(v_debits-v_credits)>=0.0001 then raise exception 'journal_not_balanced';end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'accounting.journal_draft_created','journal_entry',v_id::text,jsonb_build_object('entry_number',v_number,'debits',v_debits,'credits',v_credits,'currency',p_currency_code));
 return jsonb_build_object('ok',true,'entry_id',v_id,'entry_number',v_number,'balanced',true);
exception when others then if sqlerrm in ('invalid_journal_line','journal_not_balanced') then return jsonb_build_object('ok',false,'reason',sqlerrm);end if;raise;
end; $function$;

create or replace function public.main_workspace_post_journal_entry(p_workspace_id text,p_entry_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_debits numeric;v_credits numeric;v_count integer;v_updated uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'accountant'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 perform 1 from public.journal_entries where workspace_id=p_workspace_id and id=p_entry_id and status='draft' for update;
 if not found then return jsonb_build_object('ok',false,'reason','journal_draft_not_found');end if;
 select coalesce(sum(debit),0),coalesce(sum(credit),0),count(*) into v_debits,v_credits,v_count from public.journal_entry_lines where workspace_id=p_workspace_id and entry_id=p_entry_id;
 if v_count<2 or abs(v_debits-v_credits)>=0.0001 or v_debits<=0 then return jsonb_build_object('ok',false,'reason','journal_not_balanced');end if;
 update public.journal_entries set status='posted',posted_by=v_user,posted_at=now() where workspace_id=p_workspace_id and id=p_entry_id returning id into v_updated;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'accounting.journal_posted','journal_entry',v_updated::text,jsonb_build_object('debits',v_debits,'credits',v_credits));
 return jsonb_build_object('ok',true,'entry_id',v_updated);
end; $function$;
revoke all on function public.main_workspace_create_bank_account(text,text,text,text,text,uuid,numeric) from public,anon;
revoke all on function public.main_workspace_import_bank_statement(text,uuid,jsonb,numeric,numeric,date,date,uuid) from public,anon;
revoke all on function public.main_workspace_suggest_bank_matches(text,uuid) from public,anon;
revoke all on function public.main_workspace_confirm_bank_match(text,uuid) from public,anon;
revoke all on function public.main_workspace_reconcile_bank_import(text,uuid) from public,anon;
revoke all on function public.main_workspace_save_fx_rate(text,text,text,numeric,date,text) from public,anon;
revoke all on function public.main_workspace_create_journal_entry(text,date,text,text,jsonb,uuid) from public,anon;
revoke all on function public.main_workspace_post_journal_entry(text,uuid) from public,anon;
grant execute on function public.main_workspace_create_bank_account(text,text,text,text,text,uuid,numeric) to authenticated;
grant execute on function public.main_workspace_import_bank_statement(text,uuid,jsonb,numeric,numeric,date,date,uuid) to authenticated;
grant execute on function public.main_workspace_suggest_bank_matches(text,uuid) to authenticated;
grant execute on function public.main_workspace_confirm_bank_match(text,uuid) to authenticated;
grant execute on function public.main_workspace_reconcile_bank_import(text,uuid) to authenticated;
grant execute on function public.main_workspace_save_fx_rate(text,text,text,numeric,date,text) to authenticated;
grant execute on function public.main_workspace_create_journal_entry(text,date,text,text,jsonb,uuid) to authenticated;
grant execute on function public.main_workspace_post_journal_entry(text,uuid) to authenticated;
commit;
