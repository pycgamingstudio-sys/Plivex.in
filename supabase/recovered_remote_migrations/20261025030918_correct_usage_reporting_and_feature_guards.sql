create or replace function public.enforce_plan_limit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ws text; v_plan text; v_resource text:=tg_argv[0]; v_period text; v_limit int; v_used int; v_month date:=public.ist_month_start(); v_dup boolean; v_feature text;
begin
 if auth.role()='service_role' then v_ws:=new.workspace_id; else select p.workspace_id into v_ws from public.profiles p where p.id=auth.uid(); if v_ws is null then raise exception using errcode='42501',message='WORKSPACE_REQUIRED'; end if; end if;
 new.workspace_id:=v_ws; new.created_at:=clock_timestamp();
 if tg_table_name='workspace_members' then new.owner_id:=coalesce(auth.uid(),new.owner_id); end if;
 v_plan:=public.current_plan(v_ws);
 if v_resource='leads' then v_feature:='lead_pipeline'; elsif v_resource='team_members' then v_feature:='team'; elsif tg_table_name='invoices' and upper(coalesce(new.currency,'INR'))<>'INR' then v_feature:='multi_currency'; end if;
 if v_feature is not null and not public.plan_feature_allowed(v_ws,v_feature) then
   insert into public.plan_rejections(workspace_id,resource,plan,reason,actor_id) values(v_ws,v_feature,v_plan,'PLAN_FEATURE_LOCKED',auth.uid());
   raise exception using errcode='P0001',message=format('PLAN_FEATURE_LOCKED|%s|pro',v_feature);
 end if;
 select period,max_count into v_period,v_limit from public.plan_limits where plan=v_plan and resource=v_resource;
 if v_limit is null then raise exception 'Missing plan limit for %/%',v_plan,v_resource; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_ws||':'||v_resource,0));
 if new.client_id is not null then execute format('select exists(select 1 from public.%I where workspace_id=$1 and client_id=$2)',tg_table_name) into v_dup using v_ws,new.client_id; if v_dup then return new; end if; end if;
 if v_period='month' then
  insert into public.usage_counters values(v_ws,v_resource,v_month,0) on conflict do nothing;
  select used_count into v_used from public.usage_counters where workspace_id=v_ws and resource=v_resource and month=v_month for update;
 elsif v_resource='team_members' then
  select count(*)::int into v_used from public.workspace_members where workspace_id=v_ws and status::text in('accepted','active') and user_id is distinct from owner_id;
 else execute format('select count(*)::int from public.%I where workspace_id=$1',tg_table_name) into v_used using v_ws;
 end if;
 if v_used>=v_limit then insert into public.plan_rejections(workspace_id,resource,plan,max_count,reason,actor_id) values(v_ws,v_resource,v_plan,v_limit,'PLAN_LIMIT_REACHED',auth.uid()); raise exception using errcode='P0001',message=format('PLAN_LIMIT_REACHED|%s|%s|%s',v_resource,v_limit,v_plan); end if;
 if v_period='month' then update public.usage_counters set used_count=used_count+1 where workspace_id=v_ws and resource=v_resource and month=v_month; end if;
 if tg_table_name='invoices' then new.created_by:=coalesce(auth.uid(),new.created_by); new.number:=public.next_invoice_number(v_ws); end if;
 return new;
end $$;
create or replace function public.get_access_status(p_workspace_id text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_plan text; v_expires timestamptz; v_limits jsonb; v_usage jsonb; v_features jsonb; v_reset timestamptz;
begin
 if auth.role()<>'service_role' and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.workspace_id=p_workspace_id) then raise exception using errcode='42501',message='WORKSPACE_ACCESS_DENIED'; end if;
 v_plan:=public.current_plan(p_workspace_id);
 select max(s.expires_at) into v_expires from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at>clock_timestamp();
 select coalesce(jsonb_object_agg(resource,max_count),'{}'::jsonb) into v_limits from public.plan_limits where plan=v_plan;
 select jsonb_object_agg(pl.resource,case
  when pl.period='month' then coalesce(uc.used_count,0)
  when pl.resource='clients' then (select count(*) from public.clients c where c.workspace_id=p_workspace_id)
  when pl.resource='stock' then (select count(*) from public.stock s where s.workspace_id=p_workspace_id)
  when pl.resource='leads' then (select count(*) from public.leads l where l.workspace_id=p_workspace_id)
  when pl.resource='services' then (select count(*) from public.services s where s.workspace_id=p_workspace_id)
  when pl.resource='team_members' then (select count(*) from public.workspace_members wm where wm.workspace_id=p_workspace_id and wm.status::text in('accepted','active') and wm.user_id is distinct from wm.owner_id)
  else 0 end) into v_usage
 from public.plan_limits pl left join public.usage_counters uc on uc.workspace_id=p_workspace_id and uc.resource=pl.resource and uc.month=public.ist_month_start() where pl.plan=v_plan;
 select coalesce(jsonb_object_agg(feature,allowed),'{}'::jsonb) into v_features from public.plan_features where plan=v_plan;
 v_reset:=(public.ist_month_start()+interval '1 month')::timestamp at time zone 'Asia/Kolkata';
 return jsonb_build_object('plan',v_plan,'planName',case v_plan when 'free' then 'Free' when 'basic' then 'Basic' else 'Pro' end,'expiresAt',v_expires,'limits',v_limits,'usage',coalesce(v_usage,'{}'::jsonb),'resetsAt',v_reset,'features',coalesce(v_features,'{}'::jsonb),'trialActive',false);
end $$;
