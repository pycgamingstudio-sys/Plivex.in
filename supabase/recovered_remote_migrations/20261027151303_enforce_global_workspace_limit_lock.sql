create or replace function public.guard_workspace_over_limit_write()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_ws text;
  v_plan text;
  v_resource text;
  v_used bigint;
  v_limit integer;
  v_period text;
  v_cycle date;
begin
  if auth.role() = 'service_role' then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if auth.uid() is not null then
    select p.workspace_id into v_ws from public.profiles p where p.id=auth.uid();
  else
    v_ws := coalesce(to_jsonb(OLD)->>'workspace_id', to_jsonb(NEW)->>'workspace_id');
  end if;
  if v_ws is null then
    raise exception using errcode='42501', message='WORKSPACE_REQUIRED';
  end if;

  v_plan := public.current_plan(v_ws);
  v_cycle := public.workspace_cycle_start(v_ws);

  for v_resource, v_limit, v_period in
    select resource, max_count, period from public.plan_limits where plan=v_plan
  loop
    if v_resource = 'invoices' then
      select count(*) into v_used from public.invoices where workspace_id=v_ws
        and created_at >= (v_cycle::timestamp at time zone 'Asia/Kolkata')
        and created_at < ((v_cycle + interval '1 month')::timestamp at time zone 'Asia/Kolkata');
    elsif v_resource = 'quotations' then
      select count(*) into v_used from public.quotations where workspace_id=v_ws
        and created_at >= (v_cycle::timestamp at time zone 'Asia/Kolkata')
        and created_at < ((v_cycle + interval '1 month')::timestamp at time zone 'Asia/Kolkata');
    elsif v_resource = 'expenses' then
      select count(*) into v_used from public.expenses where workspace_id=v_ws
        and created_at >= (v_cycle::timestamp at time zone 'Asia/Kolkata')
        and created_at < ((v_cycle + interval '1 month')::timestamp at time zone 'Asia/Kolkata');
    elsif v_resource = 'clients' then
      select count(*) into v_used from public.clients where workspace_id=v_ws;
    elsif v_resource = 'stock' then
      select count(*) into v_used from public.stock where workspace_id=v_ws;
    elsif v_resource = 'services' then
      select count(*) into v_used from public.services where workspace_id=v_ws;
    elsif v_resource = 'leads' then
      select count(*) into v_used from public.leads where workspace_id=v_ws;
    elsif v_resource = 'team_members' then
      select count(*) into v_used from public.workspace_members
        where workspace_id=v_ws and status::text in ('accepted','active') and user_id is distinct from owner_id;
    else
      v_used := 0;
    end if;
    if v_used > v_limit then
      raise exception using errcode='P0001',
        message=format('PLAN_LIMIT_REACHED|%s|%s|%s', v_resource, v_limit, v_plan);
    end if;
  end loop;

  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['clients','expenses','invoices','leads','quotations','services','stock','workspace_members'] loop
    execute format('drop trigger if exists guard_plan_over_limit_write on public.%I', t);
    execute format('create trigger guard_plan_over_limit_write before insert or update or delete on public.%I for each row execute function public.guard_workspace_over_limit_write()', t);
  end loop;
end $$;
