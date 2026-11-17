-- Permit manager-created expenses to post their mandatory balanced journal entry.
-- The RPC remains service_role-only; callers cannot submit arbitrary journal entries.
begin;
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
    or coalesce(p_source_type,'manual') not in ('manual','opening_balance','invoice_issued','invoice_payment','invoice_refund','expense','purchase','purchase_payment','fx_revaluation','stock_adjustment')
    or jsonb_typeof(coalesce(p_lines,'null')) <> 'array'
    or jsonb_array_length(case when jsonb_typeof(p_lines)='array' then p_lines else '[]'::jsonb end) not between 2 and 100 then
    return jsonb_build_object('ok',false,'reason','invalid_journal_entry');
  end if;

  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','accountant')
    and not (v_role='manager' and coalesce(p_source_type,'manual') in ('invoice_issued','invoice_payment','expense')) then
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
revoke all on function public.global_post_journal_entry(uuid,uuid,date,text,text,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.global_post_journal_entry(uuid,uuid,date,text,text,text,uuid,jsonb,uuid) to service_role;
commit;
