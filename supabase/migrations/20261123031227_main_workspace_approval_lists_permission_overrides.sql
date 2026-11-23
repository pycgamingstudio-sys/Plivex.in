-- Read queue and explicit permission overrides for the Main Workspace enterprise controls.
begin;
create or replace function public.main_workspace_list_approval_requests(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_role app_role; v_rows jsonb;
begin
 if v_user is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 select role into v_role from public.profiles where id=v_user and workspace_id=p_workspace_id;
 if v_role is null then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'action_type',r.action_type,'entity_type',r.entity_type,'entity_id',r.entity_id,'amount',r.amount,'currency_code',r.currency_code,'requested_by',r.requested_by,'status',r.status,'current_level',r.current_level,'approval_levels',r.approval_levels,'created_at',r.created_at,'steps',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'level',s.level,'approver_role',s.approver_role,'status',s.status,'due_at',s.due_at,'escalated_at',s.escalated_at,'decision_note',s.decision_note) order by s.level),'[]'::jsonb) from public.workspace_approval_steps s where s.request_id=r.id)) order by r.created_at desc),'[]'::jsonb)
 into v_rows from public.workspace_approval_requests r where r.workspace_id=p_workspace_id and
 (r.requested_by=v_user or v_role in ('admin','manager','accountant') or exists(select 1 from public.workspace_approval_steps s where s.request_id=r.id and s.level=r.current_level and s.approver_role=v_role and s.status='pending'));
 return jsonb_build_object('ok',true,'requests',v_rows);
end; $function$;

create or replace function public.main_workspace_permission_override_set(p_workspace_id text,p_member_id uuid,p_role app_role,p_permission_key text,p_effect text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_member public.workspace_members%rowtype;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if (p_member_id is not null) = (p_role is not null) or p_permission_key not in ('approval.request','approval.decide','approval.read','audit.read','export.request','fx.convert','branch.read','invoice.read','invoice.create') or p_effect not in ('allow','deny') then return jsonb_build_object('ok',false,'reason','invalid_override'); end if;
 if p_member_id is not null then
  select * into v_member from public.workspace_members where id=p_member_id and workspace_id=p_workspace_id and status='active';
  if not found then return jsonb_build_object('ok',false,'reason','member_not_found'); end if;
  delete from public.workspace_permission_overrides where workspace_id=p_workspace_id and member_id=p_member_id and permission_key=p_permission_key;
  insert into public.workspace_permission_overrides(workspace_id,member_id,permission_key,effect,set_by) values(p_workspace_id,p_member_id,p_permission_key,p_effect,v_user);
 else
  delete from public.workspace_permission_overrides where workspace_id=p_workspace_id and role=p_role and permission_key=p_permission_key;
  insert into public.workspace_permission_overrides(workspace_id,role,permission_key,effect,set_by) values(p_workspace_id,p_role,p_permission_key,p_effect,v_user);
 end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'permission.override.updated','permission_override',coalesce(p_member_id::text,p_role::text),jsonb_build_object('permission_key',p_permission_key,'effect',p_effect));
 return jsonb_build_object('ok',true);
end; $function$;

create or replace function public.main_workspace_has_permission(p_workspace_id text,p_member_id uuid,p_permission_key text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare v_role app_role; v_effect text;
begin
 select role into v_role from public.workspace_members where id=p_member_id and workspace_id=p_workspace_id and status='active';
 if v_role is null then return false; end if;
 select effect into v_effect from public.workspace_permission_overrides where workspace_id=p_workspace_id and member_id=p_member_id and permission_key=p_permission_key limit 1;
 if found then return v_effect='allow'; end if;
 select effect into v_effect from public.workspace_permission_overrides where workspace_id=p_workspace_id and role=v_role and permission_key=p_permission_key limit 1;
 if found then return v_effect='allow'; end if;
 return exists(select 1 from public.workspace_permission_delegations d where d.workspace_id=p_workspace_id and d.delegate_member_id=p_member_id and d.revoked_at is null and d.starts_at<=now() and d.expires_at>now() and p_permission_key=any(d.permission_keys));
end; $function$;
revoke all on function public.main_workspace_list_approval_requests(text) from public,anon;
revoke all on function public.main_workspace_permission_override_set(text,uuid,app_role,text,text) from public,anon;
revoke all on function public.main_workspace_has_permission(text,uuid,text) from public,anon,authenticated;
grant execute on function public.main_workspace_list_approval_requests(text) to authenticated;
grant execute on function public.main_workspace_permission_override_set(text,uuid,app_role,text,text) to authenticated;
grant execute on function public.main_workspace_has_permission(text,uuid,text) to service_role;
commit;
