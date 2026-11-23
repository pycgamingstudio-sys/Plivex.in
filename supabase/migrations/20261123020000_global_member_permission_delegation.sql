-- Add an owner/admin-only member directory for per-person permission delegation.
begin;

create or replace function public.global_enterprise_members(
  p_user_id uuid,
  p_workspace_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_members jsonb;
begin
  if p_user_id is null or p_workspace_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;

  select role into v_role
  from global.workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and status = 'active'
  limit 1;

  if coalesce(v_role, '') not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'ACCESS_DENIED');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'userId', user_id,
    'role', role,
    'status', status
  ) order by created_at), '[]'::jsonb)
  into v_members
  from (
    select id, user_id, role, status, created_at
    from global.workspace_members
    where workspace_id = p_workspace_id
      and status = 'active'
    order by created_at
    limit 200
  ) active_members;

  return jsonb_build_object('ok', true, 'members', v_members);
end;
$function$;

revoke all on function public.global_enterprise_members(uuid, uuid) from public, anon, authenticated;
grant execute on function public.global_enterprise_members(uuid, uuid) to service_role;

commit;
