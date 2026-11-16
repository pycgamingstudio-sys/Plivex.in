-- Part 7: foreign-currency expense posting with immutable FX provenance.
-- Candidate-only additive migration; no live database is changed.
begin;

alter table global.expenses
  add column if not exists transaction_amount_minor bigint,
  add column if not exists transaction_currency_code text,
  add column if not exists fx_snapshot_id uuid references global.exchange_rate_snapshots(id) on delete restrict,
  add column if not exists fx_rate_numerator numeric(38,0),
  add column if not exists fx_rate_denominator numeric(38,0),
  add column if not exists fx_source_url text,
  add column if not exists fx_provider text,
  add column if not exists fx_effective_at timestamptz,
  add column if not exists creation_idempotency_key uuid,
  add column if not exists creation_request_fingerprint text;

update global.expenses
set transaction_amount_minor = amount_minor,
    transaction_currency_code = currency_code
where transaction_amount_minor is null or transaction_currency_code is null;

alter table global.expenses
  alter column transaction_amount_minor set not null,
  alter column transaction_currency_code set not null;

do $block$
begin
  if not exists (select 1 from pg_constraint where conname='global_expenses_transaction_amount_check') then
    alter table global.expenses add constraint global_expenses_transaction_amount_check
      check (transaction_amount_minor > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='global_expenses_transaction_currency_check') then
    alter table global.expenses add constraint global_expenses_transaction_currency_check
      check (transaction_currency_code ~ '^[A-Z]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='global_expenses_fx_pair_check') then
    alter table global.expenses add constraint global_expenses_fx_pair_check
      check (
        (transaction_currency_code = currency_code and fx_snapshot_id is null
          and fx_rate_numerator is null and fx_rate_denominator is null)
        or
        (transaction_currency_code <> currency_code and fx_snapshot_id is not null
          and fx_rate_numerator is not null and fx_rate_numerator > 0
          and fx_rate_denominator is not null and fx_rate_denominator > 0
          and fx_source_url is not null and fx_source_url like 'https://%'
          and fx_provider is not null and nullif(btrim(fx_provider),'') is not null
          and fx_effective_at is not null)
      );
  end if;
end;
$block$;

create or replace function global.expenses_fill_transaction_defaults()
returns trigger language plpgsql set search_path = pg_catalog, global
as $function$
begin
  if tg_op = 'INSERT' then
    new.transaction_amount_minor := coalesce(new.transaction_amount_minor,new.amount_minor);
    new.transaction_currency_code := coalesce(new.transaction_currency_code,new.currency_code);
  elsif tg_op = 'UPDATE' then
    if old.fx_snapshot_id is not null and
      (new.amount_minor is distinct from old.amount_minor or new.currency_code is distinct from old.currency_code) then
      raise exception 'foreign currency expense base amount is immutable';
    end if;
    if old.fx_snapshot_id is null then
      new.transaction_amount_minor := new.amount_minor;
      new.transaction_currency_code := new.currency_code;
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists global_expenses_fill_transaction_defaults on global.expenses;
create trigger global_expenses_fill_transaction_defaults
  before insert or update on global.expenses
  for each row execute function global.expenses_fill_transaction_defaults();

create unique index if not exists global_expenses_idempotency_idx
  on global.expenses(workspace_id, creation_idempotency_key)
  where creation_idempotency_key is not null;
create index if not exists global_expenses_fx_snapshot_idx
  on global.expenses(fx_snapshot_id) where fx_snapshot_id is not null;

create or replace function public.global_create_expense_with_fx(
  p_user_id uuid,
  p_workspace_id uuid,
  p_category text,
  p_vendor text,
  p_transaction_amount_minor bigint,
  p_transaction_currency_code text,
  p_expense_date date,
  p_idempotency_key uuid,
  p_rate_numerator numeric default null,
  p_rate_denominator numeric default null,
  p_source_url text default null,
  p_provider text default null,
  p_effective_at timestamptz default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_workspace_currency text;
  v_fingerprint text;
  v_existing global.expenses%rowtype;
  v_snapshot_id uuid;
  v_base_precision integer;
  v_transaction_precision integer;
  v_converted numeric;
  v_numerator numeric;
  v_denominator numeric;
  v_base_amount bigint;
  v_snapshot global.exchange_rate_snapshots%rowtype;
  v_expense global.expenses%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or p_idempotency_key is null
    or p_transaction_amount_minor is null or p_transaction_amount_minor <= 0
    or p_transaction_amount_minor > 9000000000000000
    or p_expense_date is null
    or length(btrim(coalesce(p_category,''))) not between 1 and 100
    or coalesce(length(p_vendor),0)>200 or coalesce(length(p_notes),0)>1000
    or p_transaction_currency_code is null or p_transaction_currency_code not in ('INR','USD','EUR','GBP','AED','CAD','AUD','SGD','JPY','KRW','KWD','BHD','OMR','JOD') then
    return jsonb_build_object('ok',false,'reason','invalid_expense');
  end if;
  select role into v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager','accountant') then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  select currency_code into v_workspace_currency from global.workspaces where id=p_workspace_id;
  if v_workspace_currency is null then return jsonb_build_object('ok',false,'reason','workspace_not_found'); end if;
  if v_workspace_currency not in ('INR','USD','EUR','GBP','AED','CAD','AUD','SGD','JPY','KRW','KWD','BHD','OMR','JOD') then
    return jsonb_build_object('ok',false,'reason','unsupported_base_currency');
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'category',btrim(p_category),'vendor',p_vendor,'amount',p_transaction_amount_minor,
    'currency',p_transaction_currency_code,'date',p_expense_date,'rateNumerator',p_rate_numerator,
    'rateDenominator',p_rate_denominator,'source',p_source_url,'provider',p_provider,
    'effectiveAt',p_effective_at,'notes',p_notes
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_idempotency_key::text,0));
  select * into v_existing from global.expenses
    where workspace_id=p_workspace_id and creation_idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.creation_request_fingerprint is distinct from v_fingerprint then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict');
    end if;
    return jsonb_build_object('ok',true,'duplicate',true,'record',to_jsonb(v_existing));
  end if;

  v_transaction_precision := case p_transaction_currency_code
    when 'JPY' then 0 when 'KRW' then 0 when 'KWD' then 3 when 'BHD' then 3
    when 'OMR' then 3 when 'JOD' then 3 else 2 end;
  v_base_precision := case v_workspace_currency
    when 'JPY' then 0 when 'KRW' then 0 when 'KWD' then 3 when 'BHD' then 3
    when 'OMR' then 3 when 'JOD' then 3 else 2 end;

  if p_transaction_currency_code = v_workspace_currency then
    if p_rate_numerator is not null or p_rate_denominator is not null or p_source_url is not null
      or p_provider is not null or p_effective_at is not null then
      return jsonb_build_object('ok',false,'reason','unnecessary_fx_snapshot');
    end if;
    v_base_amount := p_transaction_amount_minor;
  else
    if p_rate_numerator is null or p_rate_denominator is null
      or p_rate_numerator <= 0 or p_rate_denominator <= 0
      or p_rate_numerator::text !~ '^[0-9]+([.]0+)?$'
      or p_rate_denominator::text !~ '^[0-9]+([.]0+)?$'
      or p_source_url is null or p_source_url !~ '^https://'
      or p_source_url ~ '^https://[^/]*@'
      or p_provider is null or length(btrim(coalesce(p_provider,''))) not between 1 and 100
      or p_effective_at is null or p_effective_at > now()
      or p_effective_at >= (((p_expense_date + 1)::timestamp) at time zone 'UTC') then
      return jsonb_build_object('ok',false,'reason','fx_snapshot_required');
    end if;
    insert into global.exchange_rate_snapshots(
      workspace_id,base_currency,quote_currency,rate_numerator,rate_denominator,
      source_url,provider,effective_at,created_by
    ) values (
      p_workspace_id,p_transaction_currency_code,v_workspace_currency,
      p_rate_numerator,p_rate_denominator,p_source_url,btrim(p_provider),p_effective_at,p_user_id
    ) returning id into v_snapshot_id;
    v_numerator := p_transaction_amount_minor * p_rate_numerator * power(10::numeric,v_base_precision);
    v_denominator := p_rate_denominator * power(10::numeric,v_transaction_precision);
    v_converted := floor(v_numerator / v_denominator + 0.5);
    if v_converted <= 0 or v_converted > 9000000000000000 then
      raise exception 'converted expense amount outside supported range';
    end if;
    v_base_amount := v_converted::bigint;
    insert into global.currency_conversion_history(
      workspace_id,snapshot_id,created_by,base_amount_minor,quote_amount_minor,
      base_currency,quote_currency,rounding_mode
    ) values (
      p_workspace_id,v_snapshot_id,p_user_id,p_transaction_amount_minor,v_base_amount,
      p_transaction_currency_code,v_workspace_currency,'half_up'
    );
  end if;

  insert into global.expenses(
    workspace_id,category,vendor,amount_minor,currency_code,expense_date,notes,created_by,
    transaction_amount_minor,transaction_currency_code,fx_snapshot_id,fx_rate_numerator,
    fx_rate_denominator,fx_source_url,fx_provider,fx_effective_at,
    creation_idempotency_key,creation_request_fingerprint
  ) values (
    p_workspace_id,btrim(p_category),nullif(btrim(p_vendor),''),v_base_amount,v_workspace_currency,
    p_expense_date,nullif(btrim(p_notes),''),p_user_id,p_transaction_amount_minor,
    p_transaction_currency_code,v_snapshot_id,
    case when v_snapshot_id is null then null else p_rate_numerator end,
    case when v_snapshot_id is null then null else p_rate_denominator end,
    case when v_snapshot_id is null then null else p_source_url end,
    case when v_snapshot_id is null then null else btrim(p_provider) end,
    case when v_snapshot_id is null then null else p_effective_at end,
    p_idempotency_key,v_fingerprint
  ) returning * into v_expense;

  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values (p_workspace_id,p_user_id,'expense.created','expense',v_expense.id::text,
    jsonb_build_object('transactionCurrency',p_transaction_currency_code,'baseCurrency',v_workspace_currency,
      'transactionAmountMinor',p_transaction_amount_minor,'baseAmountMinor',v_base_amount,
      'fxSnapshotId',v_snapshot_id));
  return jsonb_build_object('ok',true,'duplicate',false,'record',to_jsonb(v_expense));
end;
$function$;

revoke all on function public.global_create_expense_with_fx(uuid,uuid,text,text,bigint,text,date,uuid,numeric,numeric,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.global_create_expense_with_fx(uuid,uuid,text,text,bigint,text,date,uuid,numeric,numeric,text,text,timestamptz,text) to service_role;

commit;
