-- Post a balanced Main Workspace receivable/revenue/tax journal atomically when an invoice is issued.
-- Draft edits never enter the ledger; the trigger is idempotent by workspace and invoice.
begin;

create unique index if not exists journal_entries_invoice_source_unique
  on public.journal_entries(workspace_id,source_type,source_id)
  where source_type='invoice_issued' and source_id is not null;

create or replace function public.post_main_workspace_invoice_journal()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_actor uuid:=coalesce(auth.uid(),new.created_by);
  v_receivable_account uuid;
  v_revenue_account uuid;
  v_tax_account uuid;
  v_entry_id uuid;
  v_existing public.journal_entries%rowtype;
  v_total numeric(18,4);
  v_tax numeric(18,4);
  v_revenue numeric(18,4);
  v_idempotency_key uuid;
  v_fingerprint text;
  v_entry_number text;
begin
  if new.is_draft is distinct from false
    or lower(coalesce(new.status,'')) in ('draft','cancelled','canceled','void') then
    return new;
  end if;

  if tg_op='UPDATE' and old.is_draft is distinct from true then
    return new;
  end if;

  if v_actor is null then
    raise exception using errcode='23502',message='invoice_ledger_actor_required';
  end if;

  v_total:=round(coalesce(new.total,0),4);
  v_tax:=round(coalesce(new.tax_value,0),4);
  v_revenue:=round(v_total-v_tax,4);
  if v_total<=0 or v_tax<0 or v_revenue<0 then
    raise exception using errcode='22023',message='invalid_invoice_ledger_amounts';
  end if;

  v_idempotency_key:=md5('plivex:invoice-issued:'||new.workspace_id||':'||new.id::text)::uuid;
  v_fingerprint:=md5(jsonb_build_object(
    'invoice_id',new.id,
    'invoice_number',new.number,
    'issue_date',new.issue_date,
    'currency',upper(new.currency),
    'total',v_total,
    'tax',v_tax,
    'revenue',v_revenue
  )::text);

  select * into v_existing
  from public.journal_entries
  where workspace_id=new.workspace_id
    and source_type='invoice_issued'
    and source_id=new.id::text
  for update;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode='23505',message='invoice_journal_payload_conflict';
    end if;
    return new;
  end if;

  select id into v_receivable_account
  from public.accounting_accounts
  where workspace_id=new.workspace_id and code='1100' and account_type='asset' and is_active
  limit 1;
  select id into v_revenue_account
  from public.accounting_accounts
  where workspace_id=new.workspace_id and code='4000' and account_type='revenue' and is_active
  limit 1;
  if v_tax>0 then
    select id into v_tax_account
    from public.accounting_accounts
    where workspace_id=new.workspace_id and code='2100' and account_type='liability' and is_active
    limit 1;
  end if;

  if v_receivable_account is null or (v_revenue>0 and v_revenue_account is null)
    or (v_tax>0 and v_tax_account is null) then
    raise exception using errcode='P0001',message='invoice_ledger_chart_account_missing';
  end if;

  v_entry_number:='AUTO-INV-'||upper(substr(replace(new.id::text,'-',''),1,16));
  insert into public.journal_entries(
    workspace_id,entry_number,entry_date,description,currency_code,
    source_type,source_id,status,idempotency_key,request_fingerprint,
    created_by,posted_by,posted_at
  ) values (
    new.workspace_id,v_entry_number,new.issue_date,
    left('Invoice issued '||coalesce(new.number,new.id::text),300),
    upper(new.currency),'invoice_issued',new.id::text,'posted',
    v_idempotency_key,v_fingerprint,v_actor,v_actor,now()
  )
  on conflict (workspace_id,source_type,source_id)
    where source_type='invoice_issued' and source_id is not null
    do nothing
  returning id into v_entry_id;

  if v_entry_id is null then
    select * into v_existing
    from public.journal_entries
    where workspace_id=new.workspace_id
      and source_type='invoice_issued'
      and source_id=new.id::text
    for update;
    if not found or v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode='23505',message='invoice_journal_payload_conflict';
    end if;
    return new;
  end if;

  insert into public.journal_entry_lines(
    workspace_id,entry_id,account_id,debit,credit,memo
  ) values (
    new.workspace_id,v_entry_id,v_receivable_account,v_total,0,
    left('Receivable for invoice '||coalesce(new.number,new.id::text),300)
  );

  if v_revenue>0 then
    insert into public.journal_entry_lines(
      workspace_id,entry_id,account_id,debit,credit,memo
    ) values (
      new.workspace_id,v_entry_id,v_revenue_account,0,v_revenue,
      left('Sales revenue for invoice '||coalesce(new.number,new.id::text),300)
    );
  end if;

  if v_tax>0 then
    insert into public.journal_entry_lines(
      workspace_id,entry_id,account_id,debit,credit,memo
    ) values (
      new.workspace_id,v_entry_id,v_tax_account,0,v_tax,
      left('Tax payable for invoice '||coalesce(new.number,new.id::text),300)
    );
  end if;

  insert into public.workspace_audit_events(
    workspace_id,actor_id,action,entity_type,entity_id,metadata
  ) values (
    new.workspace_id,v_actor,'accounting.invoice_journal_posted',
    'invoice',new.id::text,
    jsonb_build_object(
      'journal_entry_id',v_entry_id,'invoice_number',new.number,
      'currency_code',upper(new.currency),'receivable',v_total,
      'revenue',v_revenue,'tax_payable',v_tax
    )
  );

  return new;
end;
$function$;

drop trigger if exists post_main_workspace_invoice_journal on public.invoices;
create trigger post_main_workspace_invoice_journal
after insert or update of is_draft on public.invoices
for each row execute function public.post_main_workspace_invoice_journal();

commit;
