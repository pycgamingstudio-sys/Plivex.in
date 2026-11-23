create or replace function public.main_workspace_list_approval_requests(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_role app_role;v_member_id uuid;v_rows jsonb;
begin
 if v_user is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 select role into v_role from public.profiles where id=v_user and workspace_id=p_workspace_id;
 select id into v_member_id from public.workspace_members where workspace_id=p_workspace_id and user_id=v_user and status='active' limit 1;
 if v_role is null or v_member_id is null then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'action_type',r.action_type,'entity_type',r.entity_type,'entity_id',r.entity_id,'amount',r.amount,'currency_code',r.currency_code,'requested_by',r.requested_by,'status',r.status,'current_level',r.current_level,'approval_levels',r.approval_levels,'created_at',r.created_at,'steps',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'level',s.level,'approver_role',s.approver_role,'status',s.status,'due_at',s.due_at,'escalated_at',s.escalated_at,'decision_note',s.decision_note) order by s.level),'[]'::jsonb) from public.workspace_approval_steps s where s.request_id=r.id)) order by r.created_at desc),'[]'::jsonb)
 into v_rows from public.workspace_approval_requests r where r.workspace_id=p_workspace_id and (
  r.requested_by=v_user or v_role in ('admin','manager','accountant')
  or exists(select 1 from public.workspace_approval_steps s where s.request_id=r.id and s.level=r.current_level and s.approver_role=v_role and s.status='pending')
  or exists(select 1 from public.workspace_approval_steps s join public.workspace_permission_delegations d on d.workspace_id=s.workspace_id and d.delegate_member_id=v_member_id
   join public.workspace_members delegator on delegator.id=d.delegator_member_id and delegator.workspace_id=d.workspace_id
   where s.request_id=r.id and s.level=r.current_level and s.status='pending' and d.revoked_at is null and d.starts_at<=now() and d.expires_at>now()
    and d.permission_keys && array['approval.read','approval.decide']::text[] and delegator.status='active' and delegator.role=s.approver_role
    and (public.main_workspace_has_permission(p_workspace_id,v_member_id,'approval.read') or public.main_workspace_has_permission(p_workspace_id,v_member_id,'approval.decide')))
 );
 return jsonb_build_object('ok',true,'requests',v_rows);
end;$function$;
revoke all on function public.main_workspace_list_approval_requests(text) from public,anon;
grant execute on function public.main_workspace_list_approval_requests(text) to authenticated;