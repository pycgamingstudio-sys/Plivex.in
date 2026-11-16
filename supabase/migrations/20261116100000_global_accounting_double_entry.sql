-- Part 3: workspace-scoped double-entry accounting foundation.
-- Additive Global schema only. Existing India tables and production data are untouched.
begin;

create table if not exists global.accounting_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  code text not null check (code ~ '^[0-9A-Z][0-9A-Z._-]{1,19}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  account_type text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  normal_balance text not null check (normal_balance in ('debit','credit')),
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,id),
  unique (workspace_id,code),
  check (
    (account_type in ('asset','expense') and normal_balance='debit')
    or (account_type in ('liability','equity','revenue') and normal_balance='credit')
  )
);
create index if not exists global_accounting_accounts_workspace_type_idx
  on global.accounting_accounts(workspace_id,account_type,is_active);

create table if not exists global.journal_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  entry_date date not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  memo text not null check (length(btrim(memo)) between 1 and 500),
  source_type text not null default 'manual'
    check (source_type in ('manual','opening_balance','invoice_issued','invoice_payment','invoice_refund','expense','purchase','stock_adjustment')),
  source_id uuid,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{32}$'),
  status text not null default 'posted' check (status='posted'),
  posted_by uuid not null references auth.users(id) on delete restrict,
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id,id),
  unique (workspace_id,idempotency_key)
);
create index if not exists global_journal_entries_workspace_date_idx
  on global.journal_entries(workspace_id,entry_date desc,posted_at desc);
create index if not exists global_journal_entries_workspace_source_idx
  on global.journal_entries(workspace_id,source_type,source_id) where source_id is not null;

create table if not exists global.journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  journal_entry_id uuid not null,
  account_id uuid not null,
  description text,
  debit_minor bigint not null default 0 check (debit_minor between 0 and 9000000000000000),
  credit_minor bigint not null default 0 check (credit_minor between 0 and 9000000000000000),
  created_at timestamptz not null default now(),
  foreign key (workspace_id,journal_entry_id)
    references global.journal_entries(workspace_id,id) on delete restrict,
  foreign key (workspace_id,account_id)
    references global.accounting_accounts(workspace_id,id) on delete restrict,
  check ((debit_minor > 0 and credit_minor=0) or (credit_minor > 0 and debit_minor=0))
);
create index if not exists global_journal_lines_workspace_account_idx
  on global.journal_entry_lines(workspace_id,account_id,journal_entry_id);
create index if not exists global_journal_lines_entry_idx
  on global.journal_entry_lines(workspace_id,journal_entry_id);

alter table global.accounting_accounts enable row level security;
alter table global.journal_entries enable row level security;
alter table global.journal_entry_lines enable row level security;

drop policy if exists global_accounting_accounts_select_member on global.accounting_accounts;
create policy global_accounting_accounts_select_member on global.accounting_accounts
  for select to authenticated using (global.is_workspace_member(workspace_id));
drop policy if exists global_journal_entries_select_member on global.journal_entries;
create policy global_journal_entries_select_member on global.journal_entries
  for select to authenticated using (global.is_workspace_member(workspace_id));
drop policy if exists global_journal_lines_select_member on global.journal_entry_lines;
create policy global_journal_lines_select_member on global.journal_entry_lines
  for select to authenticated using (global.is_workspace_member(workspace_id));

revoke all on global.accounting_accounts,global.journal_entries,global.journal_entry_lines
  from public,anon,authenticated;
grant select on global.accounting_accounts,global.journal_entries,global.journal_entry_lines to authenticated;
grant all on global.accounting_accounts,global.journal_entries,global.journal_entry_lines to service_role;

create or replace function global.seed_default_chart_of_accounts(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog,global
as $function$
begin
  insert into global.accounting_accounts(workspace_id,code,name,account_type,normal_balance,is_system)
  values
    (p_workspace_id,'1000','Cash on Hand','asset','debit',true),
    (p_workspace_id,'1010','Bank Account','asset','debit',true),
    (p_workspace_id,'1100','Accounts Receivable','asset','debit',true),
    (p_workspace_id,'1200','Inventory','asset','debit',true),
    (p_workspace_id,'2000','Accounts Payable','liability','credit',true),
    (p_workspace_id,'2100','Tax Payable','liability','credit',true),
    (p_workspace_id,'3000','Owner Equity','equity','credit',true),
    (p_workspace_id,'3100','Retained Earnings','equity','credit',true),
    (p_workspace_id,'4000','Sales Revenue','revenue','credit',true),
    (p_workspace_id,'4100','Other Income','revenue','credit',true),
    (p_workspace_id,'5000','Cost of Goods Sold','expense','debit',true),
    (p_workspace_id,'6000','Operating Expenses','expense','debit',true),
    (p_workspace_id,'6100','Bank & Payment Fees','expense','debit',true)
  on conflict (workspace_id,code) do nothing;
end;
$function$;

create or replace function global.seed_workspace_chart_of_accounts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog,global
as $function$
begin
  perform global.seed_default_chart_of_accounts(new.id);
  return new;
end;
$function$;

drop trigger if exists global_workspace_seed_chart_of_accounts on global.workspaces;
create trigger global_workspace_seed_chart_of_accounts
  after insert on global.workspaces
  for each row execute function global.seed_workspace_chart_of_accounts();

-- Backfill only missing standard accounts; no financial entries are fabricated.
do $seed_existing$
declare v_workspace record;
begin
  for v_workspace in select id from global.workspaces loop
    perform global.seed_default_chart_of_accounts(v_workspace.id);
  end loop;
end;
$seed_existing$;

create or replace function global.guard_posted_journal_entry()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode='55000',message='Posted journal entries are immutable';
end;
$function$;

drop trigger if exists global_journal_entries_immutable on global.journal_entries;
create trigger global_journal_entries_immutable
  before update or delete on global.journal_entries
  for each row execute function global.guard_posted_journal_entry();
drop trigger if exists global_journal_lines_immutable on global.journal_entry_lines;
create trigger global_journal_lines_immutable
  before update or delete on global.journal_entry_lines
  for each row execute function global.guard_posted_journal_entry();

create or replace function public.global_post_journal_entry(
  p_user_id uuid,
  p_workspace_id uuid,
  p_entry_date date,
  p_currency_code text,
  p_memo text,
  p_source_type text,
  p_source_id uuid,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog,global
as $function$
declare
  v_role text;
  v_currency text;
  v_existing global.journal_entries%rowtype;
  v_entry global.journal_entries%rowtype;
  v_line jsonb;
  v_account global.accounting_accounts%rowtype;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_debit_line bigint;
  v_credit_line bigint;
  v_count integer := 0;
  v_fingerprint text;
  v_lines jsonb := '[]'::jsonb;
begin
  if p_user_id is null or p_workspace_id is null or p_entry_date is null
    or p_idempotency_key is null or upper(coalesce(p_currency_code,'')) !~ '^[A-Z]{3}$'
    or length(btrim(coalesce(p_memo,''))) not between 1 and 500
    or coalesce(p_source_type,'manual') not in ('manual','opening_balance','invoice_issued','invoice_payment','invoice_refund','expense','purchase','stock_adjustment')
    or jsonb_typeof(coalesce(p_lines,'null')) <> 'array'
    or jsonb_array_length(case when jsonb_typeof(p_lines)='array' then p_lines else '[]'::jsonb end) not between 2 and 100 then
    return jsonb_build_object('ok',false,'reason','invalid_journal_entry');
  end if;

  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','accountant') then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  select currency_code into v_currency from global.workspaces where id=p_workspace_id;
  if v_currency is null then return jsonb_build_object('ok',false,'reason','workspace_not_found'); end if;
  if upper(p_currency_code)<>v_currency then
    return jsonb_build_object('ok',false,'reason','currency_mismatch');
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'entry_date',p_entry_date,'currency_code',v_currency,'memo',btrim(p_memo),
    'source_type',coalesce(p_source_type,'manual'),'source_id',p_source_id,'lines',p_lines
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||p_idempotency_key::text,0));
  select * into v_existing from global.journal_entries
  where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict');
    end if;
    return jsonb_build_object('ok',true,'duplicate',true,'entry',to_jsonb(v_existing));
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_count:=v_count+1;
    begin
      select * into strict v_account from global.accounting_accounts
      where workspace_id=p_workspace_id and code=btrim(v_line->>'account_code') and is_active=true;
      v_debit_line:=coalesce(nullif(v_line->>'debit_minor','')::bigint,0);
      v_credit_line:=coalesce(nullif(v_line->>'credit_minor','')::bigint,0);
    exception when no_data_found then
      return jsonb_build_object('ok',false,'reason','account_not_found','line_index',v_count);
    when others then
      return jsonb_build_object('ok',false,'reason','invalid_journal_line','line_index',v_count);
    end;
    if (v_debit_line>0 and v_credit_line>0) or (v_debit_line=0 and v_credit_line=0)
      or v_debit_line<0 or v_credit_line<0
      or v_debit_line>9000000000000000 or v_credit_line>9000000000000000
      or length(coalesce(v_line->>'description',''))>300 then
      return jsonb_build_object('ok',false,'reason','invalid_journal_line','line_index',v_count);
    end if;
    v_debit:=v_debit+v_debit_line;
    v_credit:=v_credit+v_credit_line;
    if v_debit>9000000000000000 or v_credit>9000000000000000 then
      return jsonb_build_object('ok',false,'reason','journal_amount_limit');
    end if;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'account_id',v_account.id,'description',nullif(btrim(v_line->>'description'),''),
      'debit_minor',v_debit_line,'credit_minor',v_credit_line
    ));
  end loop;
  if v_debit=0 or v_debit<>v_credit then
    return jsonb_build_object('ok',false,'reason','unbalanced_journal','debit_minor',v_debit,'credit_minor',v_credit);
  end if;

  insert into global.journal_entries(
    workspace_id,entry_date,currency_code,memo,source_type,source_id,idempotency_key,
    request_fingerprint,posted_by
  ) values (
    p_workspace_id,p_entry_date,v_currency,btrim(p_memo),coalesce(p_source_type,'manual'),
    p_source_id,p_idempotency_key,v_fingerprint,p_user_id
  ) returning * into v_entry;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    insert into global.journal_entry_lines(
      workspace_id,journal_entry_id,account_id,description,debit_minor,credit_minor
    ) values (
      p_workspace_id,v_entry.id,(v_line->>'account_id')::uuid,v_line->>'description',
      (v_line->>'debit_minor')::bigint,(v_line->>'credit_minor')::bigint
    );
  end loop;
  return jsonb_build_object('ok',true,'duplicate',false,'entry',to_jsonb(v_entry),'line_count',v_count);
end;
$function$;

revoke all on function public.global_post_journal_entry(uuid,uuid,date,text,text,text,uuid,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.global_post_journal_entry(uuid,uuid,date,text,text,text,uuid,jsonb,uuid)
  to service_role;

create or replace function public.global_get_trial_balance(
  p_workspace_id uuid,p_from date default null,p_to date default null,p_currency_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog,global
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not global.is_workspace_member(p_workspace_id) then
    raise exception using errcode='42501',message='Workspace access denied';
  end if;
  if p_from is not null and p_to is not null and p_to<p_from then
    raise exception using errcode='22023',message='Invalid report date range';
  end if;
  select jsonb_build_object(
    'currency_code',coalesce(upper(p_currency_code),(select currency_code from global.workspaces where id=p_workspace_id)),
    'from',p_from,'to',p_to,
    'accounts',coalesce(jsonb_agg(jsonb_build_object(
      'code',a.code,'name',a.name,'account_type',a.account_type,
      'debit_minor',coalesce(x.debit_minor,0),'credit_minor',coalesce(x.credit_minor,0),
      'net_debit_minor',coalesce(x.debit_minor,0)-coalesce(x.credit_minor,0)
    ) order by a.code),'[]'::jsonb),
    'total_debit_minor',coalesce(sum(coalesce(x.debit_minor,0)),0),
    'total_credit_minor',coalesce(sum(coalesce(x.credit_minor,0)),0)
  ) into v_result
  from global.accounting_accounts a
  left join (
    select l.workspace_id,l.account_id,sum(l.debit_minor)::bigint debit_minor,
      sum(l.credit_minor)::bigint credit_minor
    from global.journal_entry_lines l
    join global.journal_entries e on e.workspace_id=l.workspace_id and e.id=l.journal_entry_id
    where l.workspace_id=p_workspace_id
      and (p_from is null or e.entry_date>=p_from)
      and (p_to is null or e.entry_date<=p_to)
      and (p_currency_code is null or e.currency_code=upper(p_currency_code))
    group by l.workspace_id,l.account_id
  ) x on x.workspace_id=a.workspace_id and x.account_id=a.id
  where a.workspace_id=p_workspace_id and a.is_active=true;
  return v_result;
end;
$function$;

create or replace function public.global_get_general_ledger(
  p_workspace_id uuid,p_account_code text,p_from date default null,p_to date default null,p_currency_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog,global
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not global.is_workspace_member(p_workspace_id) then
    raise exception using errcode='42501',message='Workspace access denied';
  end if;
  if p_account_code is null or length(btrim(p_account_code))=0
    or (p_from is not null and p_to is not null and p_to<p_from) then
    raise exception using errcode='22023',message='Invalid ledger filters';
  end if;
  select jsonb_build_object(
    'account_code',a.code,'account_name',a.name,
    'currency_code',coalesce(upper(p_currency_code),(select currency_code from global.workspaces where id=p_workspace_id)),
    'entries',coalesce(jsonb_agg(jsonb_build_object(
      'entry_id',q.entry_id,'entry_date',q.entry_date,'memo',q.memo,'source_type',q.source_type,
      'description',q.description,'debit_minor',q.debit_minor,'credit_minor',q.credit_minor,
      'running_debit_minor',q.running_debit_minor
    ) order by q.entry_date,q.posted_at,q.line_id),'[]'::jsonb)
  ) into v_result
  from global.accounting_accounts a
  left join (
    select e.workspace_id,e.id entry_id,e.entry_date,e.memo,e.source_type,e.posted_at,
      l.id line_id,l.description,l.debit_minor,l.credit_minor,
      sum(l.debit_minor-l.credit_minor) over(order by e.entry_date,e.posted_at,l.id rows unbounded preceding)::bigint running_debit_minor
    from global.journal_entries e
    join global.journal_entry_lines l on l.workspace_id=e.workspace_id and l.journal_entry_id=e.id
    join global.accounting_accounts aa on aa.workspace_id=l.workspace_id and aa.id=l.account_id
    where e.workspace_id=p_workspace_id and aa.code=btrim(p_account_code)
      and (p_from is null or e.entry_date>=p_from)
      and (p_to is null or e.entry_date<=p_to)
      and (p_currency_code is null or e.currency_code=upper(p_currency_code))
  ) q on true
  where a.workspace_id=p_workspace_id and a.code=btrim(p_account_code);
  return coalesce(v_result,jsonb_build_object('reason','account_not_found'));
end;
$function$;

revoke all on function public.global_get_trial_balance(uuid,date,date,text) from public,anon;
revoke all on function public.global_get_general_ledger(uuid,text,date,date,text) from public,anon;
grant execute on function public.global_get_trial_balance(uuid,date,date,text) to authenticated,service_role;
grant execute on function public.global_get_general_ledger(uuid,text,date,date,text) to authenticated,service_role;

drop trigger if exists global_accounting_accounts_set_updated_at on global.accounting_accounts;
create trigger global_accounting_accounts_set_updated_at before update on global.accounting_accounts
  for each row execute function global.set_updated_at();

comment on table global.accounting_accounts is 'Workspace-scoped chart of accounts with conventional account classes and normal balances.';
comment on table global.journal_entries is 'Append-only posted double-entry journal headers; each entry is balanced in one ISO currency.';
comment on table global.journal_entry_lines is 'Immutable debit/credit lines; amounts are integer minor currency units.';
comment on function public.global_post_journal_entry(uuid,uuid,date,text,text,text,uuid,jsonb,uuid) is
  'Service-role-only atomic journal posting RPC; validates membership, account ownership, currency, idempotency and exact debit/credit balance.';
comment on function public.global_get_trial_balance(uuid,date,date,text) is
  'Workspace-member-only trial balance, grouped by account and filtered to one currency and date range.';
comment on function public.global_get_general_ledger(uuid,text,date,date,text) is
  'Workspace-member-only account ledger with chronological running debit-minus-credit balance.';

commit;
