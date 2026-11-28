-- Stage 2 hardening: preserve raw bank rows and make statement imports payload-idempotent.
begin;

alter table public.bank_statement_imports
  add column if not exists request_fingerprint text;
alter table public.bank_statement_transactions
  add column if not exists source_row integer,
  add column if not exists raw_row jsonb;
create index if not exists bank_statement_transactions_source_row_idx
  on public.bank_statement_transactions(import_id, source_row);

create or replace function public.main_workspace_import_bank_statement(
  p_workspace_id text,
  p_bank_account_id uuid,
  p_rows jsonb,
  p_opening_balance numeric,
  p_closing_balance numeric,
  p_start date,
  p_end date,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user uuid := auth.uid();
  v_account public.workspace_bank_accounts%rowtype;
  v_import public.bank_statement_imports%rowtype;
  v_row jsonb;
  v_date date;
  v_amount numeric;
  v_direction text;
  v_desc text;
  v_ref text;
  v_source_row integer;
  v_count integer := 0;
  v_key text;
  v_fingerprint text;
begin
  if v_user is null or not public.has_ws_role(
    p_workspace_id,
    array['admin'::app_role, 'manager'::app_role, 'accountant'::app_role]
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) < 1
    or jsonb_array_length(p_rows) > 5000
    or p_idempotency_key is null
    or p_opening_balance is null
    or p_closing_balance is null
    or (p_start is not null and p_end is not null and p_start > p_end) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_statement');
  end if;

  select * into v_account
  from public.workspace_bank_accounts
  where workspace_id = p_workspace_id
    and id = p_bank_account_id
    and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'bank_account_not_found');
  end if;

  -- Validate every row before writing anything, so malformed input cannot leave a partial import.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) is distinct from 'object'
      or coalesce(v_row->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_row->>'direction', '') not in ('debit', 'credit')
      or coalesce(v_row->>'description', '') = ''
      or length(coalesce(v_row->>'description', '')) > 500
      or coalesce(v_row->>'amount', '') !~ '^\d+(\.\d{1,4})?$'
      or coalesce(v_row->>'sourceRow', '') !~ '^[1-9]\d*$'
      or jsonb_typeof(v_row->'rawRow') is distinct from 'object' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_bank_transaction_row');
    end if;
    begin
      v_date := (v_row->>'date')::date;
      v_amount := (v_row->>'amount')::numeric;
      v_source_row := (v_row->>'sourceRow')::integer;
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'invalid_bank_transaction_row');
    end;
    if v_amount <= 0
      or to_char(v_date, 'YYYY-MM-DD') <> v_row->>'date'
      or (p_start is not null and v_date < p_start)
      or (p_end is not null and v_date > p_end) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_bank_transaction_row');
    end if;
  end loop;

  v_fingerprint := md5(jsonb_build_object(
    'bank_account_id', p_bank_account_id,
    'rows', p_rows,
    'opening_balance', p_opening_balance,
    'closing_balance', p_closing_balance,
    'start', p_start,
    'end', p_end
  )::text);

  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id || ':' || p_idempotency_key::text, 0)
  );

  select * into v_import
  from public.bank_statement_imports
  where workspace_id = p_workspace_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_import.request_fingerprint is distinct from v_fingerprint then
      return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'import_id', v_import.id, 'duplicate', true);
  end if;

  insert into public.bank_statement_imports (
    workspace_id, bank_account_id, statement_start, statement_end,
    opening_balance, closing_balance, currency_code, idempotency_key,
    request_fingerprint, created_by
  ) values (
    p_workspace_id, p_bank_account_id, p_start, p_end,
    p_opening_balance, p_closing_balance, v_account.currency_code,
    p_idempotency_key, v_fingerprint, v_user
  ) returning * into v_import;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_date := (v_row->>'date')::date;
    v_amount := (v_row->>'amount')::numeric;
    v_direction := v_row->>'direction';
    v_desc := btrim(v_row->>'description');
    v_ref := nullif(btrim(v_row->>'reference'), '');
    v_source_row := (v_row->>'sourceRow')::integer;
    v_key := md5(
      v_source_row::text || '|' || v_date::text || '|' || v_amount::text ||
      '|' || v_direction || '|' || coalesce(v_ref, '') || '|' || v_desc
    );

    insert into public.bank_statement_transactions (
      workspace_id, import_id, transaction_date, description, reference,
      amount, direction, currency_code, category, row_key, source_row, raw_row
    ) values (
      p_workspace_id, v_import.id, v_date, v_desc, v_ref,
      v_amount, v_direction, v_account.currency_code,
      case
        when v_desc ~* '(rent|lease)' then 'Rent'
        when v_desc ~* '(salary|payroll)' then 'Salary'
        when v_desc ~* '(fuel|petrol|diesel)' then 'Fuel'
        when v_desc ~* '(electric|water|utility)' then 'Utilities'
        when v_desc ~* '(tax|gst|vat)' then 'Tax'
        when v_desc ~* '(software|subscription|cloud)' then 'Software'
        when v_direction = 'credit' then 'Customer receipt'
        else 'Uncategorised'
      end,
      v_key, v_source_row, v_row->'rawRow'
    );
    v_count := v_count + 1;
  end loop;

  insert into public.workspace_audit_events (
    workspace_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_workspace_id, v_user, 'bank.statement_imported',
    'bank_statement_import', v_import.id::text,
    jsonb_build_object(
      'rows', v_count,
      'currency_code', v_account.currency_code,
      'request_fingerprint', v_fingerprint
    )
  );

  return jsonb_build_object(
    'ok', true, 'import_id', v_import.id, 'transaction_count', v_count
  );
end;
$function$;

revoke all on function public.main_workspace_import_bank_statement(
  text, uuid, jsonb, numeric, numeric, date, date, uuid
) from public, anon;
grant execute on function public.main_workspace_import_bank_statement(
  text, uuid, jsonb, numeric, numeric, date, date, uuid
) to authenticated;

commit;
