-- Bound unauthenticated public invoice-link reads and analytics events.
-- The table is only writable through the service-role-only RPC below.
create table if not exists public.invoice_share_rate_limits (
  share_link_id uuid not null references public.invoice_share_links(id) on delete cascade,
  action text not null check (action in ('public_view', 'track')),
  window_started_at timestamptz not null default clock_timestamp(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (share_link_id, action)
);

alter table public.invoice_share_rate_limits enable row level security;
revoke all on public.invoice_share_rate_limits from public, anon, authenticated;

create or replace function public.consume_invoice_share_rate_limit(
  p_share_link_id uuid,
  p_action text,
  p_max_requests integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count integer;
  v_now timestamptz := clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_max_requests, 30), 120));
begin
  if p_action not in ('public_view', 'track') then
    raise exception 'Unsupported invoice share rate-limit action';
  end if;

  insert into public.invoice_share_rate_limits as current_limit
    (share_link_id, action, window_started_at, request_count)
  values
    (p_share_link_id, p_action, v_now, 1)
  on conflict (share_link_id, action) do update
    set window_started_at = case
          when current_limit.window_started_at <= v_now - interval '1 minute' then v_now
          else current_limit.window_started_at
        end,
        request_count = case
          when current_limit.window_started_at <= v_now - interval '1 minute' then 1
          else current_limit.request_count + 1
        end
  returning request_count into v_count;

  return v_count <= v_limit;
end
$function$;

revoke all on function public.consume_invoice_share_rate_limit(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_invoice_share_rate_limit(uuid, text, integer) to service_role;
