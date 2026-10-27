-- Make plan enforcement count persisted rows, not only usage-counter state.
-- This closes the gap for records created before counters were initialized and
-- avoids referencing fields that do not exist on every trigger table.

CREATE OR REPLACE FUNCTION public.enforce_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ws text;
  v_plan text;
  v_resource text := TG_ARGV[0];
  v_period text;
  v_limit int;
  v_used int;
  v_month date;
  v_dup boolean;
  v_feature text;
  v_client_id text;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and TG_TABLE_NAME = 'workspace_members') then
    v_ws := NEW.workspace_id;
  else
    select p.workspace_id into v_ws from public.profiles p where p.id = auth.uid();
    if v_ws is null then
      raise exception using errcode = '42501', message = 'WORKSPACE_REQUIRED';
    end if;
  end if;

  NEW.workspace_id := v_ws;
  NEW.created_at := clock_timestamp();

  if TG_TABLE_NAME = 'workspace_members' then
    NEW.owner_id := coalesce(auth.uid(), NEW.owner_id);
    if NEW.user_id is not distinct from NEW.owner_id then return NEW; end if;
  end if;

  v_plan := public.current_plan(v_ws);
  v_month := public.workspace_cycle_start(v_ws);

  if v_resource = 'leads' then
    v_feature := 'lead_pipeline';
  elsif v_resource = 'team_members' then
    v_feature := 'team';
  elsif TG_TABLE_NAME = 'invoices' and upper(coalesce(to_jsonb(NEW)->>'currency', 'INR')) <> 'INR' then
    v_feature := 'multi_currency';
  end if;

  if v_feature is not null and not public.plan_feature_allowed(v_ws, v_feature) then
    insert into public.plan_rejections(workspace_id, resource, plan, reason, actor_id)
    values(v_ws, v_feature, v_plan, 'PLAN_FEATURE_LOCKED', auth.uid());
    raise exception using errcode = 'P0001', message = format('PLAN_FEATURE_LOCKED|%s|pro', v_feature);
  end if;

  select period, max_count into v_period, v_limit
  from public.plan_limits where plan = v_plan and resource = v_resource;
  if v_limit is null then raise exception 'Missing plan limit for %/%', v_plan, v_resource; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_ws || ':' || v_resource, 0));

  -- client_id is not present on every resource table; read it generically.
  v_client_id := to_jsonb(NEW)->>'client_id';
  if nullif(v_client_id, '') is not null then
    execute format('select exists(select 1 from public.%I where workspace_id=$1 and client_id=$2)', TG_TABLE_NAME)
      into v_dup using v_ws, v_client_id::uuid;
    if v_dup then return null; end if;
  end if;

  if v_period = 'month' then
    execute format(
      'select count(*)::int from public.%I where workspace_id=$1 and created_at >= ($2::date::timestamp at time zone ''Asia/Kolkata'') and created_at < (($2::date + interval ''1 month'')::timestamp at time zone ''Asia/Kolkata'')',
      TG_TABLE_NAME
    ) into v_used using v_ws, v_month;
  elsif v_resource = 'team_members' then
    select count(*)::int into v_used from public.workspace_members
    where workspace_id = v_ws and status::text in ('accepted','active') and user_id is distinct from owner_id;
  else
    execute format('select count(*)::int from public.%I where workspace_id=$1', TG_TABLE_NAME)
      into v_used using v_ws;
  end if;

  if v_used >= v_limit then
    insert into public.plan_rejections(workspace_id, resource, plan, max_count, reason, actor_id)
    values(v_ws, v_resource, v_plan, v_limit, 'PLAN_LIMIT_REACHED', auth.uid());
    raise exception using errcode = 'P0001', message = format('PLAN_LIMIT_REACHED|%s|%s|%s', v_resource, v_limit, v_plan);
  end if;

  if v_period = 'month' then
    insert into public.usage_counters(workspace_id, resource, month, used_count)
    values(v_ws, v_resource, v_month, v_used + 1)
    on conflict (workspace_id, resource, month)
    do update set used_count = excluded.used_count;
  end if;

  if TG_TABLE_NAME = 'invoices' then
    NEW.created_by := coalesce(auth.uid(), NEW.created_by);
    NEW.number := public.next_invoice_number(v_ws);
  end if;
  return NEW;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_access_status(p_workspace_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_plan text;
  v_expires timestamptz;
  v_limits jsonb;
  v_usage jsonb;
  v_features jsonb;
  v_cycle date;
  v_reset timestamptz;
begin
  if auth.role() <> 'service_role'
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.workspace_id = p_workspace_id) then
    raise exception using errcode = '42501', message = 'WORKSPACE_ACCESS_DENIED';
  end if;

  v_plan := public.current_plan(p_workspace_id);
  v_cycle := public.workspace_cycle_start(p_workspace_id);

  select max(s.expires_at) into v_expires
  from public.subscriptions s
  where s.workspace_id = p_workspace_id
    and s.status::text = 'active'
    and s.expires_at > clock_timestamp()
    and s.started_at <= clock_timestamp()
    and s.tier::text in ('basic','pro');

  select coalesce(jsonb_object_agg(resource,max_count),'{}'::jsonb)
    into v_limits from public.plan_limits where plan = v_plan;

  select jsonb_object_agg(pl.resource,
    case
      when pl.period = 'month' and pl.resource = 'invoices' then
        (select count(*) from public.invoices i where i.workspace_id = p_workspace_id
          and i.created_at >= (v_cycle::timestamp at time zone 'Asia/Kolkata')
          and i.created_at < ((v_cycle + interval '1 month')::timestamp at time zone 'Asia/Kolkata'))
      when pl.period = 'month' and pl.resource = 'quotations' then
        (select count(*) from public.quotations q where q.workspace_id = p_workspace_id
          and q.created_at >= (v_cycle::timestamp at time zone 'Asia/Kolkata')
          and q.created_at < ((v_cycle + interval '1 month')::timestamp at time zone 'Asia/Kolkata'))
      when pl.period = 'month' and pl.resource = 'expenses' then
        (select count(*) from public.expenses e where e.workspace_id = p_workspace_id
          and e.created_at >= (v_cycle::timestamp at time zone 'Asia/Kolkata')
          and e.created_at < ((v_cycle + interval '1 month')::timestamp at time zone 'Asia/Kolkata'))
      when pl.resource = 'clients' then (select count(*) from public.clients c where c.workspace_id = p_workspace_id)
      when pl.resource = 'stock' then (select count(*) from public.stock s where s.workspace_id = p_workspace_id)
      when pl.resource = 'leads' then (select count(*) from public.leads l where l.workspace_id = p_workspace_id)
      when pl.resource = 'services' then (select count(*) from public.services s where s.workspace_id = p_workspace_id)
      when pl.resource = 'team_members' then (select count(*) from public.workspace_members wm where wm.workspace_id = p_workspace_id and wm.status::text in ('accepted','active') and wm.user_id is distinct from wm.owner_id)
      else 0
    end)
    into v_usage
  from public.plan_limits pl
  where pl.plan = v_plan;

  select coalesce(jsonb_object_agg(feature,allowed),'{}'::jsonb)
    into v_features from public.plan_features where plan = v_plan;

  v_reset := ((v_cycle + interval '1 month')::timestamp at time zone 'Asia/Kolkata');

  return jsonb_build_object(
    'plan',v_plan,
    'planName',case v_plan when 'free' then 'Free' when 'basic' then 'Basic' else 'Pro' end,
    'expiresAt',v_expires,
    'startedAt',case when v_plan='free' then (select min(p.created_at) from public.profiles p where p.workspace_id=p_workspace_id) else (select min(s.started_at) from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at > clock_timestamp() and s.tier::text in ('basic','pro')) end,
    'limits',v_limits,
    'usage',coalesce(v_usage,'{}'::jsonb),
    'resetsAt',v_reset,
    'features',coalesce(v_features,'{}'::jsonb),
    'trialActive',false
  );
end
$function$;
