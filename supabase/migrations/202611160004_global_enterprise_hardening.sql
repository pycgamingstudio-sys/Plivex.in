-- Part 8 hardening: revalidate export permissions, allow requester cancellation,
-- and protect audit history from ordinary deletion while retaining controlled expiry.
begin;
create or replace function global.guard_audit_event_mutation()
returns trigger language plpgsql set search_path = pg_catalog
as $function$
begin
  if tg_op='DELETE' and current_setting('app.global_retention_cleanup',true)='on' then return old; end if;
  raise exception 'immutable_audit_event' using errcode='55000';
end;
$function$;
drop trigger if exists audit_events_immutable on global.audit_events;
create trigger audit_events_immutable before update or delete on global.audit_events
for each row execute function global.guard_audit_event_mutation();

create or replace function public.global_can_export(p_user_id uuid,p_workspace_id uuid,p_export_type text)
returns boolean language plpgsql stable security definer
set search_path=pg_catalog,global
as $function$
declare v_member_id uuid; v_role text; v_export_override text; v_audit_override text;
  v_export_allowed boolean; v_audit_allowed boolean;
begin
  if p_user_id is null or p_workspace_id is null or p_export_type is null
    or p_export_type not in ('invoices','clients','products','expenses','audit_log','full_account') then return false; end if;
  select id,role into v_member_id,v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_member_id is null then return false; end if;
  if v_role in ('owner','admin') then return true; end if;
  if p_export_type='full_account' then return false; end if;
  select effect into v_export_override from global.workspace_permission_overrides
  where workspace_id=p_workspace_id and permission_key='export.request'
    and (member_id=v_member_id or (member_id is null and role=v_role))
  order by (member_id is not null) desc limit 1;
  v_export_allowed := case when v_export_override is not null then v_export_override='grant'
    else v_role in ('manager','accountant') end;
  if not v_export_allowed then return false; end if;
  if p_export_type<>'audit_log' then return true; end if;
  select effect into v_audit_override from global.workspace_permission_overrides
  where workspace_id=p_workspace_id and permission_key='audit.read'
    and (member_id=v_member_id or (member_id is null and role=v_role))
  order by (member_id is not null) desc limit 1;
  v_audit_allowed := case when v_audit_override is not null then v_audit_override='grant'
    else v_role='accountant' end;
  return v_audit_allowed;
end;
$function$;
revoke all on function public.global_can_export(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.global_can_export(uuid,uuid,text) to service_role;

create or replace function public.global_export_claim(p_user_id uuid,p_workspace_id uuid,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $function$
declare v_job global.export_jobs%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or p_job_id is null then return jsonb_build_object('ok',false,'code','INVALID_EXPORT_IDENTITY'); end if;
  select * into v_job from global.export_jobs where id=p_job_id and workspace_id=p_workspace_id
    and requested_by=p_user_id and status='queued' for update;
  if v_job.id is null then return jsonb_build_object('ok',false,'code','EXPORT_NOT_QUEUED'); end if;
  if not public.global_can_export(p_user_id,p_workspace_id,v_job.export_type) then return jsonb_build_object('ok',false,'code','EXPORT_PERMISSION_DENIED'); end if;
  update global.export_jobs set status='processing' where id=v_job.id and status='queued';
  return jsonb_build_object('ok',true,'jobId',v_job.id,'exportType',v_job.export_type,'format',v_job.format);
end;
$function$;

create or replace function public.global_export_download_path(p_user_id uuid,p_workspace_id uuid,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $function$
declare v_path text; v_type text;
begin
  select storage_path,export_type into v_path,v_type from global.export_jobs
  where id=p_job_id and workspace_id=p_workspace_id and requested_by=p_user_id and status='completed' and expires_at>now();
  if v_path is null then return jsonb_build_object('ok',false,'code','EXPORT_NOT_AVAILABLE'); end if;
  if not public.global_can_export(p_user_id,p_workspace_id,v_type) then return jsonb_build_object('ok',false,'code','EXPORT_PERMISSION_DENIED'); end if;
  return jsonb_build_object('ok',true,'storagePath',v_path);
end;
$function$;

create or replace function public.global_cancel_approval_request(p_user_id uuid,p_workspace_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $function$
declare v_id uuid;
begin
  if p_user_id is null or p_workspace_id is null or p_request_id is null
    or not exists(select 1 from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active') then
    return jsonb_build_object('ok',false,'code','ACCESS_DENIED');
  end if;
  update global.approval_requests set status='cancelled',approver_id=null,decided_at=now(),updated_at=now()
  where id=p_request_id and workspace_id=p_workspace_id and requester_id=p_user_id and status='pending'
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok',false,'code','REQUEST_NOT_CANCELLABLE'); end if;
  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id)
  values(p_workspace_id,p_user_id,'approval.cancelled','approval_request',v_id::text);
  return jsonb_build_object('ok',true,'requestId',v_id);
end;
$function$;
revoke all on function public.global_cancel_approval_request(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.global_cancel_approval_request(uuid,uuid,uuid) to service_role;

create or replace function public.global_retention_cleanup_audit(p_user_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $function$
declare v_role text; v_days integer:=365; v_deleted integer:=0;
begin
  select role into v_role from global.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if coalesce(v_role,'') not in ('owner','admin') then return jsonb_build_object('ok',false,'code','ADMIN_REQUIRED'); end if;
  select audit_retention_days into v_days from global.workspace_retention_policies where workspace_id=p_workspace_id;
  perform set_config('app.global_retention_cleanup','on',true);
  delete from global.audit_events where workspace_id=p_workspace_id and occurred_at<now()-make_interval(days=>coalesce(v_days,365));
  get diagnostics v_deleted=row_count;
  perform set_config('app.global_retention_cleanup','off',true);
  delete from global.enterprise_rate_limits where updated_at<now()-interval '1 day';
  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_workspace_id,p_user_id,'retention.cleanup','workspace_retention_policy',p_workspace_id::text,jsonb_build_object('auditEventsDeleted',v_deleted));
  return jsonb_build_object('ok',true,'auditEventsDeleted',v_deleted);
end;
$function$;
commit;
