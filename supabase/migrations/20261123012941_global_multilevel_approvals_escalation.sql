-- Ordered multi-level approvals with automatic time-based escalation.
begin;

create or replace function global.is_valid_approval_levels(p_levels jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog
as $$
declare v_role text;
begin
  if p_levels is null or jsonb_typeof(p_levels)<>'array' or jsonb_array_length(p_levels)>5 then return false; end if;
  for v_role in select jsonb_array_elements_text(p_levels) loop
    if v_role not in ('owner','admin','manager','employee','accountant') then return false; end if;
  end loop;
  return true;
end $$;

alter table global.approval_policies
  add column if not exists approval_levels jsonb not null default '[]'::jsonb,
  add column if not exists escalation_after_hours integer not null default 24,
  add column if not exists escalation_role text not null default 'admin';
alter table global.approval_policies drop constraint if exists approval_policies_approval_levels_check;
alter table global.approval_policies add constraint approval_policies_approval_levels_check
  check (global.is_valid_approval_levels(approval_levels));
alter table global.approval_policies drop constraint if exists approval_policies_escalation_after_hours_check;
alter table global.approval_policies add constraint approval_policies_escalation_after_hours_check
  check (escalation_after_hours between 1 and 720);
alter table global.approval_policies drop constraint if exists approval_policies_escalation_role_check;
alter table global.approval_policies add constraint approval_policies_escalation_role_check
  check (escalation_role in ('owner','admin','manager','accountant'));

alter table global.approval_requests
  add column if not exists current_level integer not null default 1,
  add column if not exists total_levels integer not null default 1;
alter table global.approval_requests drop constraint if exists approval_requests_level_bounds;
alter table global.approval_requests add constraint approval_requests_level_bounds
  check (current_level between 1 and 5 and total_levels between 1 and 5 and current_level<=total_levels);
create unique index if not exists global_approval_requests_workspace_id_uidx
  on global.approval_requests(workspace_id,id);

create table if not exists global.approval_request_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  request_id uuid not null,
  level integer not null check (level between 1 and 5),
  approver_roles text[] not null check (
    cardinality(approver_roles)>0 and
    approver_roles <@ array['owner','admin','manager','employee','accountant']::text[]
  ),
  status text not null default 'waiting' check (status in ('waiting','pending','approved','rejected','skipped')),
  due_at timestamptz,
  escalated_at timestamptz,
  escalation_role text not null default 'admin' check (escalation_role in ('owner','admin','manager','accountant')),
  escalation_after_hours integer not null default 24 check (escalation_after_hours between 1 and 720),
  approver_id uuid references auth.users(id) on delete set null,
  decision_note text check (decision_note is null or length(decision_note)<=2000),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,request_id,level),
  foreign key (workspace_id,request_id) references global.approval_requests(workspace_id,id) on delete cascade
);
create index if not exists global_approval_steps_due_idx
  on global.approval_request_steps(status,due_at) where status='pending';
create index if not exists global_approval_steps_request_idx
  on global.approval_request_steps(workspace_id,request_id,level);

alter table global.approval_request_steps enable row level security;
revoke all on global.approval_request_steps from public,anon,authenticated;
grant all on global.approval_request_steps to service_role;

create or replace function global.seed_approval_request_steps()
returns trigger language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_policy global.approval_policies%rowtype; v_total integer:=1; v_hours integer:=24;
  v_escalation_role text:='admin'; v_roles text[]; v_level integer;
begin
  if new.status<>'pending' then return new; end if;
  select * into v_policy from global.approval_policies
    where workspace_id=new.workspace_id and resource_type=new.resource_type and action_type=new.action_type and enabled=true
    limit 1;
  if found then
    v_hours:=v_policy.escalation_after_hours;
    v_escalation_role:=v_policy.escalation_role;
    if jsonb_array_length(v_policy.approval_levels)>0 then
      v_total:=jsonb_array_length(v_policy.approval_levels);
      for v_level in 1..v_total loop
        v_roles:=array[v_policy.approval_levels->>(v_level-1)];
        insert into global.approval_request_steps(
          workspace_id,request_id,level,approver_roles,status,due_at,escalation_role,escalation_after_hours
        ) values (
          new.workspace_id,new.id,v_level,v_roles,
          case when v_level=1 then 'pending' else 'waiting' end,
          case when v_level=1 then now()+make_interval(hours=>v_hours) else null end,
          v_escalation_role,v_hours
        );
      end loop;
    else
      v_roles:=v_policy.approver_roles;
      insert into global.approval_request_steps(
        workspace_id,request_id,level,approver_roles,status,due_at,escalation_role,escalation_after_hours
      ) values(new.workspace_id,new.id,1,v_roles,'pending',now()+make_interval(hours=>v_hours),v_escalation_role,v_hours);
    end if;
  else
    v_roles:=array['owner','admin','accountant'];
    insert into global.approval_request_steps(
      workspace_id,request_id,level,approver_roles,status,due_at,escalation_role,escalation_after_hours
    ) values(new.workspace_id,new.id,1,v_roles,'pending',now()+make_interval(hours=>v_hours),v_escalation_role,v_hours);
  end if;
  update global.approval_requests set current_level=1,total_levels=v_total where id=new.id and workspace_id=new.workspace_id;
  return new;
end $$;

drop trigger if exists global_seed_approval_request_steps on global.approval_requests;
create trigger global_seed_approval_request_steps
after insert on global.approval_requests
for each row execute function global.seed_approval_request_steps();

-- Backfill existing pending requests as one-step workflows to preserve current approvals.
insert into global.approval_request_steps(
  workspace_id,request_id,level,approver_roles,status,due_at,escalation_role,escalation_after_hours
)
select r.workspace_id,r.id,1,coalesce(p.approver_roles,array['owner','admin','accountant']::text[]),
  'pending',now()+make_interval(hours=>coalesce(p.escalation_after_hours,24)),
  coalesce(p.escalation_role,'admin'),coalesce(p.escalation_after_hours,24)
from global.approval_requests r
left join global.approval_policies p
  on p.workspace_id=r.workspace_id and p.resource_type=r.resource_type and p.action_type=r.action_type and p.enabled=true
where r.status='pending'
  and not exists(select 1 from global.approval_request_steps s where s.workspace_id=r.workspace_id and s.request_id=r.id);
update global.approval_requests r set current_level=1,total_levels=1
where r.status='pending' and not exists(
  select 1 from global.approval_request_steps s where s.workspace_id=r.workspace_id and s.request_id=r.id and s.level>1
);

create or replace function public.global_escalate_due_approvals()
returns integer language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_count integer:=0;
begin
  with due as (
    update global.approval_request_steps s set escalated_at=now(),updated_at=now()
    from global.approval_requests r
    where s.workspace_id=r.workspace_id and s.request_id=r.id
      and r.status='pending' and s.status='pending' and s.due_at<=now()
      and s.escalated_at is null and s.escalation_role is not null
    returning s.workspace_id,s.id,s.request_id,s.level,s.escalation_role
  )
  insert into global.audit_events(workspace_id,branch_id,actor_id,action,entity_type,entity_id,request_id,metadata,occurred_at)
  select d.workspace_id,r.branch_id,null,'approval.escalated','approval_step',d.id::text,d.request_id::text,
    jsonb_build_object('level',d.level,'escalation_role',d.escalation_role),now()
  from due d join global.approval_requests r on r.workspace_id=d.workspace_id and r.id=d.request_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.global_approval_request_v2(p_user_id uuid,p_workspace_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_role text; v_member_id uuid; v_override text; v_request_id uuid; v_branch_id uuid;
  v_action text; v_resource text; v_resource_id text; v_payload jsonb; v_current integer; v_total integer;
begin
  if p_user_id is null or p_workspace_id is null or jsonb_typeof(p_payload)<>'object' then
    return jsonb_build_object('ok',false,'code','INVALID_REQUEST');
  end if;
  select id,role into v_member_id,v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  select effect into v_override from global.workspace_permission_overrides
    where workspace_id=p_workspace_id and permission_key='approval.request'
      and (member_id=v_member_id or (member_id is null and role=v_role))
    order by (member_id is not null) desc,created_at desc limit 1;
  if v_role not in ('owner','admin') and (v_override='deny' or (v_override is distinct from 'grant' and v_role not in ('manager','employee','accountant'))) then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED');
  end if;
  v_action:=p_payload->>'actionType';
  v_resource:=p_payload->>'resourceType';
  v_resource_id:=nullif(btrim(p_payload->>'resourceId'),'');
  v_payload:=coalesce(p_payload->'payload','{}'::jsonb);
  if v_action not in ('expense.create','expense.update','invoice.issue','invoice.payment.record')
    or v_resource not in ('expense','invoice') or v_resource_id is null or length(v_resource_id)>200
    or jsonb_typeof(v_payload)<>'object' or length(v_payload::text)>20000 then
    return jsonb_build_object('ok',false,'code','INVALID_REQUEST');
  end if;
  if nullif(p_payload->>'branchId','') is not null then
    begin v_branch_id:=(p_payload->>'branchId')::uuid;
    exception when others then return jsonb_build_object('ok',false,'code','BRANCH_NOT_FOUND'); end;
    if not exists(select 1 from global.workspace_branches where workspace_id=p_workspace_id and id=v_branch_id) then
      return jsonb_build_object('ok',false,'code','BRANCH_NOT_FOUND');
    end if;
  end if;
  insert into global.approval_requests(workspace_id,branch_id,requester_id,action_type,resource_type,resource_id,payload,status)
  values(p_workspace_id,v_branch_id,p_user_id,v_action,v_resource,v_resource_id,v_payload,'pending')
  returning id into v_request_id;
  select current_level,total_levels into v_current,v_total from global.approval_requests where id=v_request_id;
  insert into global.audit_events(workspace_id,branch_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(p_workspace_id,v_branch_id,p_user_id,'approval.requested','approval_request',v_request_id::text,
    jsonb_build_object('action_type',v_action,'resource_type',v_resource,'current_level',v_current,'total_levels',v_total),now());
  return jsonb_build_object('ok',true,'requestId',v_request_id,'status','pending','currentLevel',v_current,'totalLevels',v_total);
end $$;

create or replace function public.global_approval_decide_v2(p_user_id uuid,p_workspace_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_role text; v_member_id uuid; v_override text; v_request global.approval_requests%rowtype;
  v_step global.approval_request_steps%rowtype; v_decision text; v_note text; v_next global.approval_request_steps%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or jsonb_typeof(p_payload)<>'object' then
    return jsonb_build_object('ok',false,'code','INVALID_REQUEST');
  end if;
  select id,role into v_member_id,v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  begin
    select * into v_request from global.approval_requests
      where workspace_id=p_workspace_id and id=(p_payload->>'requestId')::uuid for update;
  exception when others then return jsonb_build_object('ok',false,'code','REQUEST_NOT_FOUND'); end;
  if v_request.id is null then return jsonb_build_object('ok',false,'code','REQUEST_NOT_FOUND'); end if;
  if v_request.status<>'pending' then return jsonb_build_object('ok',false,'code','REQUEST_NOT_DECIDABLE'); end if;
  if v_request.requester_id=p_user_id then return jsonb_build_object('ok',false,'code','SELF_APPROVAL_BLOCKED'); end if;
  v_decision:=case when p_payload->>'decision' in ('approve','approved') then 'approved'
    when p_payload->>'decision' in ('reject','rejected') then 'rejected' else null end;
  v_note:=nullif(btrim(p_payload->>'note'),'');
  if v_decision is null or (v_note is not null and length(v_note)>2000) then
    return jsonb_build_object('ok',false,'code','INVALID_DECISION');
  end if;
  select * into v_step from global.approval_request_steps
    where workspace_id=p_workspace_id and request_id=v_request.id and level=v_request.current_level and status='pending'
    for update;
  if v_step.id is null then return jsonb_build_object('ok',false,'code','REQUEST_NOT_DECIDABLE'); end if;
  select effect into v_override from global.workspace_permission_overrides
    where workspace_id=p_workspace_id and permission_key='approval.decide'
      and (member_id=v_member_id or (member_id is null and role=v_role))
    order by (member_id is not null) desc,created_at desc limit 1;
  if v_role not in ('owner','admin') then
    if v_override='deny' then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED'); end if;
    if v_override is distinct from 'grant'
      and not (v_role=any(v_step.approver_roles) or (v_step.escalated_at is not null and v_role=v_step.escalation_role)) then
      return jsonb_build_object('ok',false,'code','APPROVER_ROLE_REQUIRED');
    end if;
  end if;
  update global.approval_request_steps set status=v_decision,approver_id=p_user_id,decision_note=v_note,
    decided_at=now(),updated_at=now() where id=v_step.id;
  if v_decision='rejected' then
    update global.approval_request_steps set status='skipped',updated_at=now()
      where workspace_id=p_workspace_id and request_id=v_request.id and status in ('waiting','pending') and id<>v_step.id;
    update global.approval_requests set status='rejected',approver_id=p_user_id,decision_note=v_note,decided_at=now(),updated_at=now()
      where id=v_request.id;
  else
    select * into v_next from global.approval_request_steps
      where workspace_id=p_workspace_id and request_id=v_request.id and status='waiting'
      order by level limit 1 for update;
    if v_next.id is not null then
      update global.approval_request_steps set status='pending',due_at=now()+make_interval(hours=>v_next.escalation_after_hours),updated_at=now()
        where id=v_next.id;
      update global.approval_requests set current_level=v_next.level,approver_id=p_user_id,updated_at=now()
        where id=v_request.id;
    else
      update global.approval_requests set status='approved',approver_id=p_user_id,decision_note=v_note,decided_at=now(),updated_at=now()
        where id=v_request.id;
    end if;
  end if;
  insert into global.audit_events(workspace_id,branch_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(p_workspace_id,v_request.branch_id,p_user_id,'approval.step.'||v_decision,'approval_step',v_step.id::text,
    jsonb_build_object('request_id',v_request.id,'level',v_step.level,'note',v_note),now());
  return jsonb_build_object('ok',true,'requestId',v_request.id,'decision',v_decision,
    'status',case when v_decision='rejected' then 'rejected' when v_next.id is not null then 'pending' else 'approved' end,
    'currentLevel',case when v_decision='rejected' then v_request.current_level when v_next.id is not null then v_next.level else v_request.total_levels end,
    'totalLevels',v_request.total_levels);
end $$;

create or replace function public.global_approval_cancel_v2(p_user_id uuid,p_workspace_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_request global.approval_requests%rowtype; v_role text;
begin
  select role into v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  select * into v_request from global.approval_requests
    where workspace_id=p_workspace_id and id=p_request_id for update;
  if v_request.id is null then return jsonb_build_object('ok',false,'code','REQUEST_NOT_CANCELLABLE'); end if;
  if v_request.status<>'pending' then return jsonb_build_object('ok',false,'code','REQUEST_NOT_CANCELLABLE'); end if;
  if v_request.requester_id<>p_user_id and v_role not in ('owner','admin') then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED');
  end if;
  update global.approval_requests set status='cancelled',decision_note='Cancelled',decided_at=now(),updated_at=now()
    where id=v_request.id;
  update global.approval_request_steps set status='skipped',updated_at=now()
    where workspace_id=p_workspace_id and request_id=v_request.id and status in ('waiting','pending');
  insert into global.audit_events(workspace_id,branch_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(p_workspace_id,v_request.branch_id,p_user_id,'approval.cancelled','approval_request',v_request.id::text,'{}'::jsonb,now());
  return jsonb_build_object('ok',true,'requestId',v_request.id,'status','cancelled');
end $$;

create or replace function public.global_approval_list_v2(p_user_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_role text; v_member_id uuid; v_override text; v_rows jsonb;
begin
  select id,role into v_member_id,v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  select effect into v_override from global.workspace_permission_overrides
    where workspace_id=p_workspace_id and permission_key='approval.read'
      and (member_id=v_member_id or (member_id is null and role=v_role))
    order by (member_id is not null) desc,created_at desc limit 1;
  if v_role not in ('owner','admin') and v_override='deny' then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED');
  end if;
  perform public.global_escalate_due_approvals();
  if v_role not in ('owner','admin','manager','accountant','viewer') and v_override is distinct from 'grant' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'requester_id',r.requester_id,'approver_id',r.approver_id,'action_type',r.action_type,
      'resource_type',r.resource_type,'resource_id',r.resource_id,'payload',r.payload,'status',r.status,
      'decision_note',r.decision_note,'created_at',r.created_at,'current_level',r.current_level,'total_levels',r.total_levels,
      'steps',(select coalesce(jsonb_agg(jsonb_build_object('level',s.level,'approver_roles',s.approver_roles,'status',s.status,
        'due_at',s.due_at,'escalated_at',s.escalated_at,'escalation_role',s.escalation_role,'approver_id',s.approver_id,
        'decision_note',s.decision_note) order by s.level),'[]'::jsonb)
        from global.approval_request_steps s where s.workspace_id=r.workspace_id and s.request_id=r.id)
    ) order by r.created_at desc),'[]'::jsonb) into v_rows
    from global.approval_requests r where r.workspace_id=p_workspace_id and r.requester_id=p_user_id and r.status='pending';
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'requester_id',r.requester_id,'approver_id',r.approver_id,'action_type',r.action_type,
      'resource_type',r.resource_type,'resource_id',r.resource_id,'payload',r.payload,'status',r.status,
      'decision_note',r.decision_note,'created_at',r.created_at,'current_level',r.current_level,'total_levels',r.total_levels,
      'steps',(select coalesce(jsonb_agg(jsonb_build_object('level',s.level,'approver_roles',s.approver_roles,'status',s.status,
        'due_at',s.due_at,'escalated_at',s.escalated_at,'escalation_role',s.escalation_role,'approver_id',s.approver_id,
        'decision_note',s.decision_note) order by s.level),'[]'::jsonb)
        from global.approval_request_steps s where s.workspace_id=r.workspace_id and s.request_id=r.id)
    ) order by r.created_at desc),'[]'::jsonb) into v_rows
    from global.approval_requests r where r.workspace_id=p_workspace_id and r.status='pending';
  end if;
  return jsonb_build_object('ok',true,'requests',v_rows);
end $$;

create or replace function public.global_set_approval_policy_v2(
  p_user_id uuid,p_workspace_id uuid,p_action_type text,p_enabled boolean,p_minimum_amount_minor bigint,
  p_approval_levels jsonb,p_escalation_after_hours integer,p_escalation_role text,p_prevent_self_approval boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_role text; v_resource text; v_roles text[]; v_id uuid;
begin
  select role into v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null or v_role not in ('owner','admin') then return jsonb_build_object('ok',false,'code','ADMIN_REQUIRED'); end if;
  if p_action_type is null or p_action_type not in ('expense.create','expense.update','invoice.issue','invoice.payment.record')
    or p_enabled is null or p_minimum_amount_minor is null or p_minimum_amount_minor<0
    or p_escalation_after_hours is null or p_escalation_after_hours not between 1 and 720
    or p_escalation_role is null or p_escalation_role not in ('owner','admin','manager','accountant')
    or p_prevent_self_approval is distinct from true then
    return jsonb_build_object('ok',false,'code','INVALID_POLICY');
  end if;
  if not global.is_valid_approval_levels(p_approval_levels) or jsonb_array_length(p_approval_levels)<1 then
    return jsonb_build_object('ok',false,'code','INVALID_POLICY');
  end if;
  select array_agg(distinct value) into v_roles from jsonb_array_elements_text(p_approval_levels) as x(value);
  v_resource:=case when p_action_type like 'invoice.%' then 'invoice' else 'expense' end;
  insert into global.approval_policies(
    workspace_id,resource_type,action_type,enabled,minimum_amount_minor,approver_roles,approval_levels,
    escalation_after_hours,escalation_role,prevent_self_approval,created_by,updated_at
  ) values (
    p_workspace_id,v_resource,p_action_type,p_enabled,p_minimum_amount_minor,v_roles,p_approval_levels,
    p_escalation_after_hours,p_escalation_role,true,p_user_id,now()
  )
  on conflict (workspace_id,resource_type,action_type) do update set
    enabled=excluded.enabled,minimum_amount_minor=excluded.minimum_amount_minor,approver_roles=excluded.approver_roles,
    approval_levels=excluded.approval_levels,escalation_after_hours=excluded.escalation_after_hours,
    escalation_role=excluded.escalation_role,prevent_self_approval=true,updated_at=now()
  returning id into v_id;
  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(p_workspace_id,p_user_id,'approval.policy.updated','approval_policy',v_id::text,
    jsonb_build_object('action_type',p_action_type,'levels',p_approval_levels,'escalation_after_hours',p_escalation_after_hours,'escalation_role',p_escalation_role),now());
  return jsonb_build_object('ok',true,'policyId',v_id);
end $$;

create or replace function public.global_list_approval_policies_v2(p_user_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_role text; v_rows jsonb;
begin
  select role into v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'resource_type',resource_type,'action_type',action_type,'enabled',enabled,
    'minimum_amount_minor',minimum_amount_minor,'approver_roles',approver_roles,'approval_levels',approval_levels,
    'escalation_after_hours',escalation_after_hours,'escalation_role',escalation_role,
    'prevent_self_approval',prevent_self_approval,'updated_at',updated_at
  ) order by resource_type,action_type),'[]'::jsonb) into v_rows
  from global.approval_policies where workspace_id=p_workspace_id;
  return jsonb_build_object('ok',true,'policies',v_rows);
end $$;

revoke all on function public.global_escalate_due_approvals() from public,anon,authenticated;
revoke all on function public.global_approval_request_v2(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.global_approval_decide_v2(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.global_approval_cancel_v2(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.global_approval_list_v2(uuid,uuid) from public,anon,authenticated;
revoke all on function public.global_set_approval_policy_v2(uuid,uuid,text,boolean,bigint,jsonb,integer,text,boolean) from public,anon,authenticated;
revoke all on function public.global_list_approval_policies_v2(uuid,uuid) from public,anon,authenticated;
revoke all on function global.seed_approval_request_steps() from public,anon,authenticated;
grant execute on function public.global_escalate_due_approvals() to service_role;
grant execute on function public.global_approval_request_v2(uuid,uuid,jsonb) to service_role;
grant execute on function public.global_approval_decide_v2(uuid,uuid,jsonb) to service_role;
grant execute on function public.global_approval_cancel_v2(uuid,uuid,uuid) to service_role;
grant execute on function public.global_approval_list_v2(uuid,uuid) to service_role;
grant execute on function public.global_set_approval_policy_v2(uuid,uuid,text,boolean,bigint,jsonb,integer,text,boolean) to service_role;
grant execute on function public.global_list_approval_policies_v2(uuid,uuid) to service_role;

do $$
declare v_job bigint;
begin
  if to_regclass('cron.job') is not null then
    for v_job in select jobid from cron.job where jobname='plivex-global-approval-escalation' loop
      perform cron.unschedule(v_job);
    end loop;
    perform cron.schedule('plivex-global-approval-escalation','*/5 * * * *','select public.global_escalate_due_approvals();');
  end if;
end $$;

commit;
