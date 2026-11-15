-- Country identity changes are requests, never direct profile edits.
-- The request is an immutable audit record. This migration deliberately does not
-- alter country_code/locale_code or rewrite invoices, payments, tax snapshots or ledgers.
begin;

create table if not exists public.workspace_country_change_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  requested_by uuid not null,
  from_country_code text,
  from_locale_code text,
  to_country_code text not null,
  to_locale_code text not null,
  reason text,
  status text not null default 'pending_review'
    check (status in ('pending_review','approved_for_manual_review','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  check (from_country_code is distinct from to_country_code
    or from_locale_code is distinct from to_locale_code),
  check (
    (to_country_code = 'IN' and to_locale_code in ('en-IN','hi-IN'))
    or (to_country_code = 'US' and to_locale_code in ('en-US','es-US'))
    or (to_country_code = 'GB' and to_locale_code = 'en-GB')
    or (to_country_code = 'AE' and to_locale_code in ('en-AE','ar-AE'))
    or (to_country_code = 'CA' and to_locale_code in ('en-CA','fr-CA'))
    or (to_country_code = 'AU' and to_locale_code = 'en-AU')
    or (to_country_code = 'SG' and to_locale_code in ('en-SG','zh-SG','ms-SG','ta-SG'))
  ),
  check (reason is null or length(reason) <= 500),
  check (review_notes is null or length(review_notes) <= 1000)
);

create unique index if not exists workspace_country_change_one_pending_idx
  on public.workspace_country_change_requests(workspace_id)
  where status = 'pending_review';

create index if not exists workspace_country_change_requests_workspace_time_idx
  on public.workspace_country_change_requests(workspace_id, requested_at desc);

alter table public.workspace_country_change_requests enable row level security;
revoke all on public.workspace_country_change_requests from public, anon, authenticated;
grant select, insert on public.workspace_country_change_requests to authenticated;

drop policy if exists workspace_country_change_admin_read on public.workspace_country_change_requests;
create policy workspace_country_change_admin_read
  on public.workspace_country_change_requests for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.workspace_id = workspace_country_change_requests.workspace_id
      and p.role::text = 'admin'
  ));
drop policy if exists workspace_country_change_admin_insert on public.workspace_country_change_requests;
create policy workspace_country_change_admin_insert
  on public.workspace_country_change_requests for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.workspace_id = workspace_country_change_requests.workspace_id
        and p.role::text = 'admin'
    )
    and exists (
      select 1 from public.business_profile bp
      where bp.workspace_id = workspace_country_change_requests.workspace_id
        and bp.country_code is not distinct from workspace_country_change_requests.from_country_code
        and bp.locale_code is not distinct from workspace_country_change_requests.from_locale_code
    )
  );

create or replace function public.request_workspace_country_change(
  p_target_country_code text,
  p_target_locale_code text,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id text;
  v_role text;
  v_current_country text;
  v_current_locale text;
  v_request public.workspace_country_change_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select p.workspace_id, p.role::text
    into v_workspace_id, v_role
  from public.profiles p
  where p.id = v_user_id;

  if v_workspace_id is null or v_role <> 'admin' then
    raise exception 'workspace_admin_required' using errcode = '42501';
  end if;

  if length(coalesce(p_reason, '')) > 500 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  if not (
    (p_target_country_code = 'IN' and p_target_locale_code in ('en-IN','hi-IN'))
    or (p_target_country_code = 'US' and p_target_locale_code in ('en-US','es-US'))
    or (p_target_country_code = 'GB' and p_target_locale_code = 'en-GB')
    or (p_target_country_code = 'AE' and p_target_locale_code in ('en-AE','ar-AE'))
    or (p_target_country_code = 'CA' and p_target_locale_code in ('en-CA','fr-CA'))
    or (p_target_country_code = 'AU' and p_target_locale_code = 'en-AU')
    or (p_target_country_code = 'SG' and p_target_locale_code in ('en-SG','zh-SG','ms-SG','ta-SG'))
  ) then
    raise exception 'unsupported_country_locale' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id, 91027));

  select bp.country_code, bp.locale_code
    into v_current_country, v_current_locale
  from public.business_profile bp
  where bp.workspace_id = v_workspace_id;

  if v_current_country is not distinct from p_target_country_code
     and v_current_locale is not distinct from p_target_locale_code then
    raise exception 'country_identity_unchanged' using errcode = '22023';
  end if;

  insert into public.workspace_country_change_requests (
    workspace_id, requested_by, from_country_code, from_locale_code,
    to_country_code, to_locale_code, reason
  ) values (
    v_workspace_id, v_user_id, v_current_country, v_current_locale,
    p_target_country_code, p_target_locale_code, nullif(btrim(p_reason), '')
  )
  returning * into v_request;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'status', v_request.status,
    'from_country_code', v_request.from_country_code,
    'from_locale_code', v_request.from_locale_code,
    'to_country_code', v_request.to_country_code,
    'to_locale_code', v_request.to_locale_code,
    'identity_changed', false
  );
exception
  when unique_violation then
    raise exception 'country_change_request_already_pending' using errcode = '23505';
end;
$function$;

revoke all on function public.request_workspace_country_change(text,text,text) from public, anon;
grant execute on function public.request_workspace_country_change(text,text,text) to authenticated;

comment on table public.workspace_country_change_requests is
  'RLS-protected country identity change requests. A request never changes workspace identity or historical records.';
comment on function public.request_workspace_country_change(text,text,text) is
  'Creates an RLS-checked admin-only pending country identity change request. Does not apply changes to business profile, invoices, payments or tax records.';

commit;
