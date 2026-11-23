begin;
create or replace function public.main_workspace_has_permission(p_workspace_id text,p_member_id uuid,p_permission_key text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare v_role app_role;v_effect text;v_default boolean:=false;
begin
 select m.role into v_role from public.workspace_members m where m.id=p_member_id and m.workspace_id=p_workspace_id and m.status='active';
 if v_role is null then return false; end if;
 select o.effect into v_effect from public.workspace_permission_overrides o where o.workspace_id=p_workspace_id and o.member_id=p_member_id and o.permission_key=p_permission_key limit 1;
 if found then return v_effect='allow'; end if;
 select o.effect into v_effect from public.workspace_permission_overrides o where o.workspace_id=p_workspace_id and o.role=v_role and o.permission_key=p_permission_key limit 1;
 if found then return v_effect='allow'; end if;
 if exists(select 1 from public.workspace_permission_delegations d join public.workspace_members delegator on delegator.id=d.delegator_member_id and delegator.workspace_id=d.workspace_id
  where d.workspace_id=p_workspace_id and d.delegate_member_id=p_member_id and d.revoked_at is null and d.starts_at<=now() and d.expires_at>now()
   and delegator.status='active' and delegator.role in ('admin'::app_role,'manager'::app_role) and p_permission_key=any(d.permission_keys)) then return true; end if;
 v_default:=case p_permission_key
  when 'approval.request' then true
  when 'approval.decide' then true
  when 'approval.read' then v_role in ('admin'::app_role,'manager'::app_role,'accountant'::app_role)
  when 'audit.read' then v_role in ('admin'::app_role,'manager'::app_role,'accountant'::app_role)
  when 'export.request' then v_role in ('admin'::app_role,'manager'::app_role,'accountant'::app_role)
  when 'fx.convert' then v_role in ('admin'::app_role,'manager'::app_role,'accountant'::app_role)
  when 'branch.read' then v_role in ('admin'::app_role,'manager'::app_role,'employee'::app_role,'storekeeper'::app_role)
  when 'invoice.read' then v_role in ('admin'::app_role,'manager'::app_role,'accountant'::app_role,'employee'::app_role)
  when 'invoice.create' then v_role in ('admin'::app_role,'manager'::app_role,'accountant'::app_role)
  else false end;
 return v_default;
end;$function$;
create or replace function public.main_workspace_user_has_permission(p_workspace_id text,p_user_id uuid,p_permission_key text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare v_member_id uuid;
begin
 if p_user_id is null then return false; end if;
 select m.id into v_member_id from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.status='active' limit 1;
 if v_member_id is null then return false; end if;
 return public.main_workspace_has_permission(p_workspace_id,v_member_id,p_permission_key);
end;$function$;
create or replace function public.main_workspace_request_approval(p_workspace_id text,p_action_type text,p_entity_type text,p_entity_id text,p_amount numeric,p_currency_code text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_policy public.workspace_approval_policies%rowtype;v_request public.workspace_approval_requests%rowtype;v_level integer;
begin
 if v_user is null or not public.main_workspace_user_has_permission(p_workspace_id,v_user,'approval.request') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_amount is null or p_amount<0 or p_currency_code !~ '^[A-Z]{3}$' or jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object' then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
 select * into v_policy from public.workspace_approval_policies where workspace_id=p_workspace_id and action_type=p_action_type and enabled=true and currency_code=p_currency_code and p_amount>=minimum_amount;
 if not found then return jsonb_build_object('ok',false,'reason','approval_policy_not_found'); end if;
 insert into public.workspace_approval_requests(workspace_id,action_type,entity_type,entity_id,amount,currency_code,requested_by,approval_levels,escalation_after_hours,escalation_role,prevent_self_approval,payload)
 values(p_workspace_id,p_action_type,p_entity_type,p_entity_id,p_amount,p_currency_code,v_user,v_policy.approval_levels,v_policy.escalation_after_hours,v_policy.escalation_role,v_policy.prevent_self_approval,p_payload) returning * into v_request;
 for v_level in 1..cardinality(v_policy.approval_levels) loop insert into public.workspace_approval_steps(workspace_id,request_id,level,approver_role,due_at) values(p_workspace_id,v_request.id,v_level,v_policy.approval_levels[v_level],now()+make_interval(hours=>v_policy.escalation_after_hours)); end loop;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'approval.requested',p_entity_type,coalesce(p_entity_id,v_request.id::text),jsonb_build_object('request_id',v_request.id,'action_type',p_action_type,'amount',p_amount,'currency_code',p_currency_code));
 return jsonb_build_object('ok',true,'request_id',v_request.id,'status',v_request.status);
end;$function$;
create or replace function public.main_workspace_decide_approval(p_workspace_id text,p_request_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_member_id uuid;v_request public.workspace_approval_requests%rowtype;v_step public.workspace_approval_steps%rowtype;v_next integer;v_direct boolean:=false;v_delegated boolean:=false;
begin
 if v_user is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 select m.id into v_member_id from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=v_user and m.status='active' limit 1;
 if v_member_id is null or not public.main_workspace_has_permission(p_workspace_id,v_member_id,'approval.decide') then return jsonb_build_object('ok',false,'reason','approver_permission_required'); end if;
 select * into v_request from public.workspace_approval_requests where workspace_id=p_workspace_id and id=p_request_id for update;
 if not found or v_request.status<>'pending' then return jsonb_build_object('ok',false,'reason','request_not_pending'); end if;
 select * into v_step from public.workspace_approval_steps where workspace_id=p_workspace_id and request_id=p_request_id and level=v_request.current_level and status='pending' for update;
 if not found then return jsonb_build_object('ok',false,'reason','approver_role_required'); end if;
 v_direct:=public.has_ws_role(p_workspace_id,array[v_step.approver_role]);
 if not v_direct then select exists(select 1 from public.workspace_permission_delegations d join public.workspace_members delegator on delegator.id=d.delegator_member_id and delegator.workspace_id=d.workspace_id
  where d.workspace_id=p_workspace_id and d.delegate_member_id=v_member_id and d.revoked_at is null and d.starts_at<=now() and d.expires_at>now()
   and d.permission_keys @> array['approval.decide']::text[] and delegator.status='active' and delegator.role=v_step.approver_role) into v_delegated; end if;
 if not v_direct and not v_delegated then return jsonb_build_object('ok',false,'reason','approver_role_required'); end if;
 if v_request.prevent_self_approval and v_request.requested_by=v_user then return jsonb_build_object('ok',false,'reason','self_approval_blocked'); end if;
 if p_decision not in ('approve','reject') or length(coalesce(p_note,''))>1000 then return jsonb_build_object('ok',false,'reason','invalid_decision'); end if;
 update public.workspace_approval_steps set status=case when p_decision='approve' then 'approved' else 'rejected' end,decided_by=v_user,decision_note=nullif(btrim(p_note),''),decided_at=now() where id=v_step.id;
 if p_decision='reject' then
  update public.workspace_approval_requests set status='rejected',decided_at=now(),updated_at=now() where id=p_request_id;
  update public.workspace_approval_steps set status='skipped' where request_id=p_request_id and level>v_request.current_level and status='pending';
 else
  v_next:=v_request.current_level+1;
  if v_next>cardinality(v_request.approval_levels) then update public.workspace_approval_requests set status='approved',decided_at=now(),updated_at=now() where id=p_request_id;
  else update public.workspace_approval_requests set current_level=v_next,updated_at=now() where id=p_request_id; update public.workspace_approval_steps set due_at=now()+make_interval(hours=>v_request.escalation_after_hours) where request_id=p_request_id and level=v_next; end if;
 end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'approval.'||p_decision,'approval_request',p_request_id::text,jsonb_build_object('level',v_step.level,'delegated',v_delegated,'note',left(coalesce(p_note,''),1000)));
 return jsonb_build_object('ok',true,'status',case when p_decision='reject' then 'rejected' when v_next>cardinality(v_request.approval_levels) then 'approved' else 'pending' end);
end;$function$;
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
    and d.permission_keys && array['approval.read','approval.decide']::text[] and delegator.status='active' and delegator.role=s.approver_role)
 );
 return jsonb_build_object('ok',true,'requests',v_rows);
end;$function$;
create or replace function public.main_workspace_convert_amount(p_workspace_id text,p_amount numeric,p_from_currency text,p_to_currency text,p_on_date date default current_date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_rate numeric;v_date date;
begin
 if v_user is null or not public.main_workspace_user_has_permission(p_workspace_id,v_user,'fx.convert') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_amount is null or p_from_currency !~ '^[A-Z]{3}$' or p_to_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('ok',false,'reason','invalid_conversion'); end if;
 if p_from_currency=p_to_currency then return jsonb_build_object('ok',true,'rate',1,'converted_amount',p_amount,'rate_date',p_on_date); end if;
 select rate,effective_date into v_rate,v_date from public.workspace_fx_rates where workspace_id=p_workspace_id and from_currency=p_from_currency and to_currency=p_to_currency and effective_date<=coalesce(p_on_date,current_date) order by effective_date desc limit 1;
 if v_rate is null then select 1.0/rate,effective_date into v_rate,v_date from public.workspace_fx_rates where workspace_id=p_workspace_id and from_currency=p_to_currency and to_currency=p_from_currency and effective_date<=coalesce(p_on_date,current_date) order by effective_date desc limit 1; end if;
 if v_rate is null then return jsonb_build_object('ok',false,'reason','fx_rate_not_found'); end if;
 return jsonb_build_object('ok',true,'rate',v_rate,'converted_amount',round(p_amount*v_rate,4),'rate_date',v_date);
end;$function$;
revoke all on function public.main_workspace_has_permission(text,uuid,text) from public,anon,authenticated;
revoke all on function public.main_workspace_user_has_permission(text,uuid,text) from public,anon,authenticated;
grant execute on function public.main_workspace_has_permission(text,uuid,text) to service_role;
grant execute on function public.main_workspace_user_has_permission(text,uuid,text) to service_role;
commit;