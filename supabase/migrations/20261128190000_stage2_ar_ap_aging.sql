-- Stage 2: currency-aware receivables and payables ageing from posted source records.
begin;

create or replace function public.global_get_ar_ap_aging(
  p_user_id uuid,
  p_workspace_id uuid,
  p_as_of date default current_date,
  p_limit integer default 200
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_ar jsonb;
  v_ap jsonb;
  v_ar_totals jsonb;
  v_ap_totals jsonb;
  v_as_of date := coalesce(p_as_of, current_date);
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  if p_user_id is null or p_workspace_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  end if;
  if p_user_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'access_denied');
  end if;

  select role into v_role
  from global.workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and status = 'active'
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'reason', 'access_denied');
  end if;
  if v_role not in ('owner', 'admin', 'accountant', 'manager') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with outstanding as (
    select i.id, i.invoice_number as reference, i.client_id,
      coalesce(c.name, 'Customer') as counterparty,
      i.currency_code, i.due_date,
      greatest(i.total_minor - i.amount_paid_minor, 0)::bigint as outstanding_minor,
      case when i.due_date is null then 0 else greatest(v_as_of - i.due_date, 0) end as overdue_days
    from global.invoices i
    left join global.clients c
      on c.workspace_id = i.workspace_id and c.id = i.client_id
    where i.workspace_id = p_workspace_id
      and lower(coalesce(i.status, '')) not in ('draft', 'void', 'cancelled', 'canceled')
      and greatest(i.total_minor - i.amount_paid_minor, 0) > 0
    order by i.due_date nulls last, i.issue_date, i.created_at
    limit v_limit
  )
  select
    coalesce(jsonb_agg(to_jsonb(x) order by x.due_date nulls last, x.reference), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(t) order by t.currency_code)
      from (
        select currency_code,
          sum(outstanding_minor)::bigint as outstanding_minor,
          sum(case when overdue_days = 0 then outstanding_minor else 0 end)::bigint as current_minor,
          sum(case when overdue_days between 1 and 30 then outstanding_minor else 0 end)::bigint as days_1_30_minor,
          sum(case when overdue_days between 31 and 60 then outstanding_minor else 0 end)::bigint as days_31_60_minor,
          sum(case when overdue_days between 61 and 90 then outstanding_minor else 0 end)::bigint as days_61_90_minor,
          sum(case when overdue_days > 90 then outstanding_minor else 0 end)::bigint as over_90_minor
        from outstanding group by currency_code
      ) t
    ), '[]'::jsonb)
  into v_ar, v_ar_totals
  from (
    select id, reference, client_id, counterparty, currency_code, due_date,
      outstanding_minor, overdue_days,
      case when overdue_days = 0 then 'current'
        when overdue_days <= 30 then '1_30'
        when overdue_days <= 60 then '31_60'
        when overdue_days <= 90 then '61_90'
        else 'over_90' end as ageing_bucket
    from outstanding
  ) x;

  with outstanding as (
    select b.id, b.supplier_invoice_number as reference, b.supplier_id,
      coalesce(s.name, 'Supplier') as counterparty,
      b.currency_code, b.due_date,
      greatest(b.total_minor - b.amount_paid_minor, 0)::bigint as outstanding_minor,
      case when b.due_date is null then 0 else greatest(v_as_of - b.due_date, 0) end as overdue_days
    from global.purchase_bills b
    left join global.suppliers s
      on s.workspace_id = b.workspace_id and s.id = b.supplier_id
    where b.workspace_id = p_workspace_id
      and lower(coalesce(b.status, '')) not in ('draft', 'void', 'cancelled', 'canceled', 'paid')
      and greatest(b.total_minor - b.amount_paid_minor, 0) > 0
    order by b.due_date nulls last, b.purchase_date, b.created_at
    limit v_limit
  )
  select
    coalesce(jsonb_agg(to_jsonb(x) order by x.due_date nulls last, x.reference), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(t) order by t.currency_code)
      from (
        select currency_code,
          sum(outstanding_minor)::bigint as outstanding_minor,
          sum(case when overdue_days = 0 then outstanding_minor else 0 end)::bigint as current_minor,
          sum(case when overdue_days between 1 and 30 then outstanding_minor else 0 end)::bigint as days_1_30_minor,
          sum(case when overdue_days between 31 and 60 then outstanding_minor else 0 end)::bigint as days_31_60_minor,
          sum(case when overdue_days between 61 and 90 then outstanding_minor else 0 end)::bigint as days_61_90_minor,
          sum(case when overdue_days > 90 then outstanding_minor else 0 end)::bigint as over_90_minor
        from outstanding group by currency_code
      ) t
    ), '[]'::jsonb)
  into v_ap, v_ap_totals
  from (
    select id, reference, supplier_id, counterparty, currency_code, due_date,
      outstanding_minor, overdue_days,
      case when overdue_days = 0 then 'current'
        when overdue_days <= 30 then '1_30'
        when overdue_days <= 60 then '31_60'
        when overdue_days <= 90 then '61_90'
        else 'over_90' end as ageing_bucket
    from outstanding
  ) x;

  return jsonb_build_object(
    'ok', true,
    'as_of', v_as_of,
    'accounts_receivable', v_ar,
    'ar_totals_by_currency', v_ar_totals,
    'accounts_payable', v_ap,
    'ap_totals_by_currency', v_ap_totals
  );
end;
$function$;

revoke all on function public.global_get_ar_ap_aging(uuid, uuid, date, integer)
  from public, anon;
grant execute on function public.global_get_ar_ap_aging(uuid, uuid, date, integer)
  to authenticated, service_role;

commit;
