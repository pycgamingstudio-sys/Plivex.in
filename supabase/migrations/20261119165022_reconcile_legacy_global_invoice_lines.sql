-- Reconcile legacy Global invoice lines with the preserved invoice-level
-- discount and tax totals. Source rows remain untouched in public schema.
begin;

create or replace function global.guard_issued_invoice_items()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, global, private
as $function$
declare
  v_status text;
begin
  -- Only a transaction marker written by this migration owner can bypass the
  -- issued-line guard; ordinary authenticated writes still hit the guard.
  if private.is_legacy_global_import() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select status into v_status from global.invoices
  where workspace_id = coalesce(new.workspace_id, old.workspace_id)
    and id = coalesce(new.invoice_id, old.invoice_id)
  for update;

  if v_status is distinct from 'draft' then
    raise exception using errcode = '55000', message = 'Issued invoice lines are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

insert into private.legacy_global_import_transactions(transaction_id)
values (txid_current()) on conflict do nothing;

do $preflight$
begin
  if exists (
    select 1
    from global.invoices i
    left join lateral (
      select
        count(*)::integer item_count,
        sum(round(ii.quantity * ii.unit_price_minor)::bigint) item_base_minor
      from global.invoice_items ii
      where ii.workspace_id=i.workspace_id and ii.invoice_id=i.id
    ) lines on true
    where i.invoice_snapshot ? '_legacy_public_invoice'
      and (
        coalesce(lines.item_count,0)=0
        or coalesce(lines.item_base_minor,0)<>i.subtotal_minor
        or i.discount_minor<0 or i.discount_minor>i.subtotal_minor
        or i.tax_minor<0
        or i.total_minor<>i.subtotal_minor-i.discount_minor+i.tax_minor
      )
  ) then
    raise exception 'Legacy invoice line reconciliation stopped: source line bases or header totals do not balance';
  end if;
end
$preflight$;

with base_rows as (
  select
    ii.id,ii.workspace_id,ii.invoice_id,ii.sort_order,
    round(ii.quantity*ii.unit_price_minor)::bigint as base_minor,
    i.discount_minor as header_discount_minor,
    i.tax_minor as header_tax_minor,
    sum(round(ii.quantity*ii.unit_price_minor)::bigint)
      over(partition by ii.workspace_id,ii.invoice_id) as total_base_minor,
    row_number() over(partition by ii.workspace_id,ii.invoice_id order by ii.sort_order,ii.id) as row_no,
    count(*) over(partition by ii.workspace_id,ii.invoice_id) as row_count
  from global.invoice_items ii
  join global.invoices i on i.workspace_id=ii.workspace_id and i.id=ii.invoice_id
  where i.invoice_snapshot ? '_legacy_public_invoice'
),
rounded_allocations as (
  select *,
    round(header_discount_minor::numeric*base_minor/nullif(total_base_minor,0))::bigint as rounded_discount_minor,
    round(header_tax_minor::numeric*base_minor/nullif(total_base_minor,0))::bigint as rounded_tax_minor
  from base_rows
),
allocated as (
  select *,
    case when row_no=row_count then
      header_discount_minor-coalesce(sum(rounded_discount_minor) over(
        partition by workspace_id,invoice_id order by row_no
        rows between unbounded preceding and 1 preceding
      ),0)
    else rounded_discount_minor end as item_discount_minor,
    case when row_no=row_count then
      header_tax_minor-coalesce(sum(rounded_tax_minor) over(
        partition by workspace_id,invoice_id order by row_no
        rows between unbounded preceding and 1 preceding
      ),0)
    else rounded_tax_minor end as item_tax_minor
  from rounded_allocations
)
update global.invoice_items target
set discount_minor=allocated.item_discount_minor,
    tax_minor=allocated.item_tax_minor,
    line_total_minor=allocated.base_minor-allocated.item_discount_minor+allocated.item_tax_minor
from allocated
where target.id=allocated.id
  and target.workspace_id=allocated.workspace_id
  and target.invoice_id=allocated.invoice_id;

do $verify$
begin
  if exists (
    select 1
    from global.invoices i
    left join lateral (
      select
        count(*)::integer item_count,
        coalesce(sum(ii.discount_minor),0) item_discount_minor,
        coalesce(sum(ii.tax_minor),0) item_tax_minor,
        coalesce(sum(ii.line_total_minor),0) item_total_minor
      from global.invoice_items ii
      where ii.workspace_id=i.workspace_id and ii.invoice_id=i.id
    ) lines on true
    where i.invoice_snapshot ? '_legacy_public_invoice'
      and (
        coalesce(lines.item_count,0)=0
        or lines.item_discount_minor<>i.discount_minor
        or lines.item_tax_minor<>i.tax_minor
        or lines.item_total_minor<>i.total_minor
      )
  ) then
    raise exception 'Legacy invoice line reconciliation failed; transaction rolled back';
  end if;
end
$verify$;

delete from private.legacy_global_import_transactions where transaction_id=txid_current();
commit;
