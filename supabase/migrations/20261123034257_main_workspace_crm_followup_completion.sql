-- Securely complete Main Workspace CRM follow-up activities.
create or replace function public.main_workspace_complete_lead_activity(p_workspace_id text,p_activity_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_id uuid;v_lead uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'employee'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden');end if;
 update public.lead_activities set completed_at=coalesce(completed_at,now()) where workspace_id=p_workspace_id and id=p_activity_id and completed_at is null returning id,lead_id into v_id,v_lead;
 if v_id is null then return jsonb_build_object('ok',false,'reason','activity_not_found_or_completed');end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'crm.follow_up_completed','lead_activity',v_id::text,jsonb_build_object('lead_id',v_lead));
 return jsonb_build_object('ok',true);
end; $function$;
revoke all on function public.main_workspace_complete_lead_activity(text,uuid) from public,anon;
grant execute on function public.main_workspace_complete_lead_activity(text,uuid) to authenticated;
