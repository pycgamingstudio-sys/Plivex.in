-- Atomic fixed-window rate limiting for Main Workspace public API/MCP keys.
begin;
create table if not exists public.public_api_rate_limits (
  key_id uuid primary key references public.public_api_keys(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check(request_count >= 0)
);
alter table public.public_api_rate_limits enable row level security;
revoke all on public.public_api_rate_limits from public,anon,authenticated;
grant all on public.public_api_rate_limits to service_role;
create policy public_api_rate_limits_deny_client_access on public.public_api_rate_limits
  for all to anon,authenticated using(false) with check(false);
create or replace function public.consume_main_workspace_api_rate_limit(
  p_key_hash text, p_limit integer default 60, p_window_seconds integer default 60
) returns boolean
language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare v_key_id uuid; v_count integer; v_now timestamptz:=clock_timestamp();
begin
  if p_key_hash is null or length(p_key_hash)<>64 or p_key_hash ~ '[^a-f0-9]'
    or p_limit<1 or p_limit>600 or p_window_seconds<1 or p_window_seconds>3600 then return false; end if;
  select id into v_key_id from public.public_api_keys
  where key_hash=p_key_hash and revoked_at is null and expires_at>v_now;
  if v_key_id is null then return false; end if;
  insert into public.public_api_rate_limits(key_id,window_started_at,request_count) values(v_key_id,v_now,1)
  on conflict(key_id) do update set
    request_count=case when public.public_api_rate_limits.window_started_at <= v_now-make_interval(secs=>p_window_seconds) then 1 else public.public_api_rate_limits.request_count+1 end,
    window_started_at=case when public.public_api_rate_limits.window_started_at <= v_now-make_interval(secs=>p_window_seconds) then v_now else public.public_api_rate_limits.window_started_at end
  returning request_count into v_count;
  return v_count<=p_limit;
end;
$function$;
revoke all on function public.consume_main_workspace_api_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_main_workspace_api_rate_limit(text,integer,integer) to service_role;
commit;
