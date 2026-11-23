-- Main Workspace sequential approvals and scoped permission delegation.
begin;
create table if not exists public.workspace_approval_policies (
 id uuid primary key default gen_random_uuid(), workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 action_type text not null check(action_type in ('expense.create','expense.update','invoice.issue','invoice.payment.record')),
 enabled boolean not null default true, minimum_amount numeric(18,4) not null default 0 check(minimum_amount>=0),
 currency_code text not null check(currency_code ~ '^[A-Z]{3}$'), approval_levels app_role[] not null check(cardinality(approval_levels) between 1 and 5),
 escalation_after_hours integer not null default 24 check(escalation_after_hours between 1 and 720),
 escalation_role app_role not null default 'admin', prevent_self_approval boolean not null default true check(prevent_self_approval),
 created_by uuid not null references auth.users(id) on delete restrict, updated_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,action_type)
);
create table if not exists public.workspace_approval_requests (
 id uuid primary key default gen_random_uuid(), workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 action_type text not null, entity_type text not null check(length(btrim(entity_type)) between 1 and 80), entity_id text,
 amount numeric(18,4) not null check(amount>=0), currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),
 requested_by uuid not null references auth.users(id) on delete restrict,
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 current_level integer not null default 1 check(current_level between 1 and 5), approval_levels app_role[] not null check(cardinality(approval_levels) between 1 and 5),
 escalation_after_hours integer not null check(escalation_after_hours between 1 and 720), escalation_role app_role not null,
 prevent_self_approval boolean not null default true, payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
 created_at timestamptz not null default now(), decided_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.workspace_approval_steps (
 id uuid primary key default gen_random_uuid(), workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 request_id uuid not null references public.workspace_approval_requests(id) on delete cascade, level integer not null check(level between 1 and 5),
 approver_role app_role not null, escalated_from_role app_role, escalated_at timestamptz, due_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected','skipped')),
 decided_by uuid references auth.users(id) on delete set null, decision_note text, created_at timestamptz not null default now(),
 decided_at timestamptz, unique(workspace_id,request_id,level)
);
create index if not exists workspace_approval_requests_queue_idx on public.workspace_approval_requests(workspace_id,status,created_at desc);
create index if not exists workspace_approval_steps_queue_idx on public.workspace_approval_steps(workspace_id,status,due_at);
create index if not exists workspace_approval_steps_request_idx on public.workspace_approval_steps(request_id,level);

create table if not exists public.workspace_permission_delegations (
 id uuid primary key default gen_random_uuid(), workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 delegator_member_id uuid not null references public.workspace_members(id) on delete cascade,
 delegate_member_id uuid not null references public.workspace_members(id) on delete cascade,
 permission_keys text[] not null check(cardinality(permission_keys) between 1 and 9),
 starts_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz,
 created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
 check(delegator_member_id<>delegate_member_id), check(expires_at>starts_at and expires_at<=starts_at+interval '90 days'),
 check(permission_keys <@ array['approval.request','approval.decide','approval.read','audit.read','export.request','fx.convert','branch.read','invoice.read','invoice.create']::text[])
);
create index if not exists workspace_permission_delegations_active_idx on public.workspace_permission_delegations(workspace_id,delegate_member_id,expires_at) where revoked_at is null;
create table if not exists public.workspace_permission_overrides (
 id uuid primary key default gen_random_uuid(), workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 member_id uuid references public.workspace_members(id) on delete cascade, role app_role,
 permission_key text not null check(permission_key in ('approval.request','approval.decide','approval.read','audit.read','export.request','fx.convert','branch.read','invoice.read','invoice.create')),
 effect text not null check(effect in ('allow','deny')), set_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), check((member_id is not null) <> (role is not null))
);
create unique index if not exists workspace_permission_member_override_uidx on public.workspace_permission_overrides(workspace_id,member_id,permission_key) where member_id is not null;
create unique index if not exists workspace_permission_role_override_uidx on public.workspace_permission_overrides(workspace_id,role,permission_key) where role is not null;

do $$
declare t text;
begin
 foreach t in array array['workspace_approval_policies','workspace_approval_requests','workspace_approval_steps','workspace_permission_delegations','workspace_permission_overrides'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('drop policy if exists %I on public.%I',t||'_deny_client_access',t);
  execute format('create policy %I on public.%I for all to anon,authenticated using(false) with check(false)',t||'_deny_client_access',t);
 end loop;
end $$;

create or replace function public.main_workspace_set_approval_policy(p_workspace_id text,p_action_type text,p_enabled boolean,p_minimum_amount numeric,p_currency_code text,p_approval_levels app_role[],p_escalation_after_hours integer,p_escalation_role app_role)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_id uuid; v_user uuid:=auth.uid();
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_action_type not in ('expense.create','expense.update','invoice.issue','invoice.payment.record') or p_enabled is null or p_minimum_amount is null or p_minimum_amount<0
  or p_currency_code !~ '^[A-Z]{3}$' or cardinality(p_approval_levels) not between 1 and 5 or p_escalation_after_hours not between 1 and 720
  or p_escalation_role not in ('admin','manager','accountant') then return jsonb_build_object('ok',false,'reason','invalid_policy'); end if;
 insert into public.workspace_approval_policies(workspace_id,action_type,enabled,minimum_amount,currency_code,approval_levels,escalation_after_hours,escalation_role,created_by,updated_by)
 values(p_workspace_id,p_action_type,p_enabled,p_minimum_amount,p_currency_code,p_approval_levels,p_escalation_after_hours,p_escalation_role,v_user,v_user)
 on conflict(workspace_id,action_type) do update set enabled=excluded.enabled,minimum_amount=excluded.minimum_amount,currency_code=excluded.currency_code,approval_levels=excluded.approval_levels,escalation_after_hours=excluded.escalation_after_hours,escalation_role=excluded.escalation_role,updated_by=v_user,updated_at=now()
 returning id into v_id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_workspace_id,v_user,'approval.policy.updated','approval_policy',v_id::text,jsonb_build_object('action_type',p_action_type,'enabled',p_enabled,'levels',p_approval_levels));
 return jsonb_build_object('ok',true,'policy_id',v_id);
end; $function$;

create or replace function public.main_workspace_request_approval(p_workspace_id text,p_action_type text,p_entity_type text,p_entity_id text,p_amount numeric,p_currency_code text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_policy public.workspace_approval_policies%rowtype; v_request public.workspace_approval_requests%rowtype; v_level integer;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'employee'::app_role,'accountant'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_amount is null or p_amount<0 or p_currency_code !~ '^[A-Z]{3}$' or jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object' then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
 select * into v_policy from public.workspace_approval_policies where workspace_id=p_workspace_id and action_type=p_action_type and enabled=true and currency_code=p_currency_code and p_amount>=minimum_amount;
 if not found then return jsonb_build_object('ok',false,'reason','approval_policy_not_found'); end if;
 insert into public.workspace_approval_requests(workspace_id,action_type,entity_type,entity_id,amount,currency_code,requested_by,approval_levels,escalation_after_hours,escalation_role,prevent_self_approval,payload)
 values(p_workspace_id,p_action_type,p_entity_type,p_entity_id,p_amount,p_currency_code,v_user,v_policy.approval_levels,v_policy.escalation_after_hours,v_policy.escalation_role,v_policy.prevent_self_approval,p_payload) returning * into v_request;
 for v_level in 1..cardinality(v_policy.approval_levels) loop
  insert into public.workspace_approval_steps(workspace_id,request_id,level,approver_role,due_at) values(p_workspace_id,v_request.id,v_level,v_policy.approval_levels[v_level],now()+make_interval(hours=>v_policy.escalation_after_hours));
 end loop;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_workspace_id,v_user,'approval.requested',p_entity_type,coalesce(p_entity_id,v_request.id::text),jsonb_build_object('request_id',v_request.id,'action_type',p_action_type,'amount',p_amount,'currency_code',p_currency_code));
 return jsonb_build_object('ok',true,'request_id',v_request.id,'status',v_request.status);
end; $function$;

create or replace function public.main_workspace_decide_approval(p_workspace_id text,p_request_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_request public.workspace_approval_requests%rowtype; v_step public.workspace_approval_steps%rowtype; v_next integer;
begin
 if v_user is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 select * into v_request from public.workspace_approval_requests where workspace_id=p_workspace_id and id=p_request_id for update;
 if not found or v_request.status<>'pending' then return jsonb_build_object('ok',false,'reason','request_not_pending'); end if;
 select * into v_step from public.workspace_approval_steps where workspace_id=p_workspace_id and request_id=p_request_id and level=v_request.current_level and status='pending' for update;
 if not found or not public.has_ws_role(p_workspace_id,array[v_step.approver_role]) then return jsonb_build_object('ok',false,'reason','approver_role_required'); end if;
 if v_request.prevent_self_approval and v_request.requested_by=v_user then return jsonb_build_object('ok',false,'reason','self_approval_blocked'); end if;
 if p_decision not in ('approve','reject') or length(coalesce(p_note,''))>1000 then return jsonb_build_object('ok',false,'reason','invalid_decision'); end if;
 update public.workspace_approval_steps set status=case when p_decision='approve' then 'approved' else 'rejected' end,decided_by=v_user,decision_note=nullif(btrim(p_note),''),decided_at=now() where id=v_step.id;
 if p_decision='reject' then
  update public.workspace_approval_requests set status='rejected',decided_at=now(),updated_at=now() where id=p_request_id;
  update public.workspace_approval_steps set status='skipped' where request_id=p_request_id and level>v_request.current_level and status='pending';
 else
  v_next:=v_request.current_level+1;
  if v_next>cardinality(v_request.approval_levels) then update public.workspace_approval_requests set status='approved',decided_at=now(),updated_at=now() where id=p_request_id;
  else update public.workspace_approval_requests set current_level=v_next,updated_at=now() where id=p_request_id;
   update public.workspace_approval_steps set due_at=now()+make_interval(hours=>v_request.escalation_after_hours) where request_id=p_request_id and level=v_next;
  end if;
 end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_workspace_id,v_user,'approval.'||p_decision,'approval_request',p_request_id::text,jsonb_build_object('level',v_step.level,'note',left(coalesce(p_note,''),1000)));
 return jsonb_build_object('ok',true,'status',case when p_decision='reject' then 'rejected' when v_next>cardinality(v_request.approval_levels) then 'approved' else 'pending' end);
end; $function$;

create or replace function public.main_workspace_cancel_approval(p_workspace_id text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_request public.workspace_approval_requests%rowtype;
begin
 if v_user is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 select * into v_request from public.workspace_approval_requests where workspace_id=p_workspace_id and id=p_request_id for update;
 if not found or v_request.status<>'pending' then return jsonb_build_object('ok',false,'reason','request_not_cancellable'); end if;
 if v_request.requested_by<>v_user and not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 update public.workspace_approval_requests set status='cancelled',updated_at=now() where id=p_request_id;
 update public.workspace_approval_steps set status='skipped' where request_id=p_request_id and status='pending';
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'approval.cancelled','approval_request',p_request_id::text,'{}'::jsonb);
 return jsonb_build_object('ok',true);
end; $function$;

create or replace function public.main_workspace_escalate_overdue_approvals()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_step record; v_count integer:=0;
begin
 for v_step in select s.id,s.workspace_id,s.request_id,r.escalation_role,s.approver_role from public.workspace_approval_steps s
  join public.workspace_approval_requests r on r.id=s.request_id
  where r.status='pending' and r.current_level=s.level and s.status='pending' and s.escalated_at is null and s.due_at<=now()
  for update of s skip locked
 loop
  update public.workspace_approval_steps set escalated_from_role=v_step.approver_role,approver_role=v_step.escalation_role,escalated_at=now(),due_at=now()+interval '24 hours' where id=v_step.id;
  insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_step.workspace_id,null,'approval.escalated','approval_request',v_step.request_id::text,jsonb_build_object('from_role',v_step.approver_role,'to_role',v_step.escalation_role,'step_id',v_step.id));
  v_count:=v_count+1;
 end loop;
 return v_count;
end; $function$;

create or replace function public.main_workspace_permission_delegation_create(p_workspace_id text,p_delegate_member_id uuid,p_permission_keys text[],p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_delegator uuid; v_delegate public.workspace_members%rowtype; v_row public.workspace_permission_delegations%rowtype;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 select id into v_delegator from public.workspace_members where workspace_id=p_workspace_id and user_id=v_user and status='active' limit 1;
 select * into v_delegate from public.workspace_members where workspace_id=p_workspace_id and id=p_delegate_member_id and status='active';
 if v_delegator is null or not found or v_delegate.id is null or v_delegate.user_id=v_user then return jsonb_build_object('ok',false,'reason','member_not_found'); end if;
 if p_permission_keys is null or cardinality(p_permission_keys) not between 1 and 9
  or p_permission_keys <@ array['approval.request','approval.decide','approval.read','audit.read','export.request','fx.convert','branch.read','invoice.read','invoice.create']::text[]
  or p_expires_at<=now() or p_expires_at>now()+interval '90 days' then return jsonb_build_object('ok',false,'reason','invalid_delegation'); end if;
 insert into public.workspace_permission_delegations(workspace_id,delegator_member_id,delegate_member_id,permission_keys,expires_at,created_by)
 values(p_workspace_id,v_delegator,p_delegate_member_id,p_permission_keys,p_expires_at,v_user) returning * into v_row;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_workspace_id,v_user,'permission.delegation.created','permission_delegation',v_row.id::text,jsonb_build_object('delegate_member_id',p_delegate_member_id,'permission_keys',p_permission_keys,'expires_at',p_expires_at));
 return jsonb_build_object('ok',true,'delegation_id',v_row.id);
end; $function$;

create or replace function public.main_workspace_permission_delegation_list(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_result jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'delegate_member_id',d.delegate_member_id,'delegate_name',m.name,'delegate_email',m.email,'permission_keys',d.permission_keys,'starts_at',d.starts_at,'expires_at',d.expires_at,'revoked_at',d.revoked_at) order by d.created_at desc),'[]'::jsonb)
 into v_result from public.workspace_permission_delegations d join public.workspace_members m on m.id=d.delegate_member_id where d.workspace_id=p_workspace_id;
 return jsonb_build_object('ok',true,'delegations',v_result);
end; $function$;

create or replace function public.main_workspace_permission_delegation_revoke(p_workspace_id text,p_delegation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_updated uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 update public.workspace_permission_delegations set revoked_at=now() where workspace_id=p_workspace_id and id=p_delegation_id and revoked_at is null returning id into v_updated;
 if v_updated is null then return jsonb_build_object('ok',false,'reason','delegation_not_found'); end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(p_workspace_id,v_user,'permission.delegation.revoked','permission_delegation',v_updated::text,'{}'::jsonb);
 return jsonb_build_object('ok',true);
end; $function$;

create or replace function public.main_workspace_has_permission(p_workspace_id text,p_member_id uuid,p_permission_key text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $function$
 select coalesce((select effect='allow' from public.workspace_permission_overrides where workspace_id=p_workspace_id and member_id=p_member_id and permission_key=p_permission_key order by created_at desc limit 1),false)
 or exists(select 1 from public.workspace_permission_delegations d where d.workspace_id=p_workspace_id and d.delegate_member_id=p_member_id and d.revoked_at is null and d.starts_at<=now() and d.expires_at>now() and p_permission_key=any(d.permission_keys));
$function$;

revoke all on function public.main_workspace_set_approval_policy(text,text,boolean,numeric,text,app_role[],integer,app_role) from public,anon;
revoke all on function public.main_workspace_request_approval(text,text,text,text,numeric,text,jsonb) from public,anon;
revoke all on function public.main_workspace_decide_approval(text,uuid,text,text) from public,anon;
revoke all on function public.main_workspace_cancel_approval(text,uuid) from public,anon;
revoke all on function public.main_workspace_escalate_overdue_approvals() from public,anon,authenticated;
revoke all on function public.main_workspace_permission_delegation_create(text,uuid,text[],timestamptz) from public,anon;
revoke all on function public.main_workspace_permission_delegation_list(text) from public,anon;
revoke all on function public.main_workspace_permission_delegation_revoke(text,uuid) from public,anon;
revoke all on function public.main_workspace_has_permission(text,uuid,text) from public,anon,authenticated;
grant execute on function public.main_workspace_set_approval_policy(text,text,boolean,numeric,text,app_role[],integer,app_role) to authenticated;
grant execute on function public.main_workspace_request_approval(text,text,text,text,numeric,text,jsonb) to authenticated;
grant execute on function public.main_workspace_decide_approval(text,uuid,text,text) to authenticated;
grant execute on function public.main_workspace_cancel_approval(text,uuid) to authenticated;
grant execute on function public.main_workspace_escalate_overdue_approvals() to service_role;
grant execute on function public.main_workspace_permission_delegation_create(text,uuid,text[],timestamptz) to authenticated;
grant execute on function public.main_workspace_permission_delegation_list(text) to authenticated;
grant execute on function public.main_workspace_permission_delegation_revoke(text,uuid) to authenticated;
grant execute on function public.main_workspace_has_permission(text,uuid,text) to service_role;
do $$ begin
 if exists(select 1 from cron.job where jobname='main-workspace-approval-escalation') then perform cron.unschedule((select jobid from cron.job where jobname='main-workspace-approval-escalation' limit 1)); end if;
 perform cron.schedule('main-workspace-approval-escalation','*/5 * * * *','select public.main_workspace_escalate_overdue_approvals();');
end $$;
commit;
