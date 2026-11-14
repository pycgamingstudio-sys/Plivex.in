create or replace function public.current_plan(p_workspace_id text)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_plan text;
begin
 select s.tier::text into v_plan from public.subscriptions s
 where s.workspace_id=p_workspace_id and s.status::text='active'
   and s.expires_at>clock_timestamp() and s.started_at<=clock_timestamp()
   and s.tier::text in('basic','pro')
 order by s.expires_at desc,s.created_at desc limit 1;
 if v_plan is not null then return v_plan; end if;
 if exists(select 1 from public.profiles p where p.workspace_id=p_workspace_id and p.trial_expires_at>clock_timestamp()) then return 'basic'; end if;
 return 'free';
end $$;
create or replace function public.get_access_status(p_workspace_id text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_plan text; v_expires timestamptz; v_trial boolean:=false; v_limits jsonb; v_usage jsonb; v_features jsonb; v_reset timestamptz;
begin
 if auth.role()<>'service_role' and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.workspace_id=p_workspace_id) then
   raise exception using errcode='42501',message='WORKSPACE_ACCESS_DENIED';
 end if;
 v_plan:=public.current_plan(p_workspace_id);
 select max(s.expires_at) into v_expires from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at>clock_timestamp();
 select exists(select 1 from public.profiles p where p.workspace_id=p_workspace_id and p.trial_expires_at>clock_timestamp()) into v_trial;
 select coalesce(jsonb_object_agg(resource,max_count),'{}'::jsonb) into v_limits from public.plan_limits where plan=v_plan;
 select coalesce(jsonb_object_agg(pl.resource,case when pl.period='month' then coalesce(uc.used_count,0) else case pl.resource when 'team_members' then (select count(*) from public.workspace_members wm where wm.workspace_id=p_workspace_id and wm.status::text in('accepted','active') and wm.user_id is distinct from wm.owner_id) else (select count(*) from public.clients c where c.workspace_id=p_workspace_id) end end),'{}'::jsonb)
 into v_usage from public.plan_limits pl left join public.usage_counters uc on uc.workspace_id=p_workspace_id and uc.resource=pl.resource and uc.month=public.ist_month_start() where pl.plan=v_plan;
 select coalesce(jsonb_object_agg(feature,allowed),'{}'::jsonb) into v_features from public.plan_features where plan=v_plan;
 v_reset:=(public.ist_month_start()+interval '1 month')::timestamp at time zone 'Asia/Kolkata';
 return jsonb_build_object('plan',v_plan,'planName',case v_plan when 'free' then 'Free' when 'basic' then 'Basic' else 'Pro' end,'expiresAt',v_expires,'limits',v_limits,'usage',coalesce(v_usage,'{}'::jsonb),'resetsAt',v_reset,'features',coalesce(v_features,'{}'::jsonb),'trialActive',false);
end $$;
revoke all on function public.get_access_status(text) from public,anon;
grant execute on function public.get_access_status(text) to authenticated,service_role;
