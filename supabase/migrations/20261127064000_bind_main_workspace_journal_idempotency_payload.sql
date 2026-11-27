-- Bind main-workspace journal idempotency keys to their request payload.
-- Existing rows remain readable; legacy keys without a fingerprint fail closed on replay.
begin;

alter table public.journal_entries
  add column if not exists request_fingerprint text;

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.journal_entries'::regclass
      and conname='journal_entries_request_fingerprint_check'
  ) then
    alter table public.journal_entries
      add constraint journal_entries_request_fingerprint_check
      check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{32}$');
  end if;
end;
$constraint$;

-- Reconstruct fingerprints for existing entries from their persisted lines.
-- Line order is intentionally canonicalized because journal line order is not semantic.
update public.journal_entries j
set request_fingerprint=md5(jsonb_build_object(
  'entry_date',j.entry_date,
  'description',btrim(j.description),
  'currency_code',j.currency_code,
  'lines',(
    select coalesce(jsonb_agg(jsonb_build_object(
      'account_id',l.account_id,'debit',l.debit,'credit',l.credit,
      'memo',left(coalesce(l.memo,''),300)
    ) order by l.account_id,l.debit,l.credit,l.memo),'[]'::jsonb)
    from public.journal_entry_lines l
    where l.workspace_id=j.workspace_id and l.entry_id=j.id
  )
)::text)
where j.request_fingerprint is null
  and exists(select 1 from public.journal_entry_lines l
    where l.workspace_id=j.workspace_id and l.entry_id=j.id);

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

commit;
