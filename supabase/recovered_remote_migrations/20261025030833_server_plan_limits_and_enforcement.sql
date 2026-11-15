begin;
do $$ begin
 if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='plan_tier' and e.enumlabel='free') then alter type public.plan_tier add value 'free'; end if;
end $$;
create table if not exists public.plan_limits(plan text not null check(plan in('free','basic','pro')),resource text not null,period text not null check(period in('month','total')),max_count int not null check(max_count>=0),primary key(plan,resource));
insert into public.plan_limits values
('free','invoices','month',30),('basic','invoices','month',100),('pro','invoices','month',3000),
('free','quotations','month',10),('basic','quotations','month',50),('pro','quotations','month',1000),
('free','expenses','month',30),('basic','expenses','month',1000),('pro','expenses','month',10000),
('free','clients','total',20),('basic','clients','total',200),('pro','clients','total',50000),
('free','stock','total',20),('basic','stock','total',200),('pro','stock','total',50000),
('free','services','total',10),('basic','services','total',50),('pro','services','total',1000),
('free','leads','total',0),('basic','leads','total',0),('pro','leads','total',50000),
('free','team_members','total',0),('basic','team_members','total',0),('pro','team_members','total',5)
on conflict(plan,resource) do update set period=excluded.period,max_count=excluded.max_count;
create table if not exists public.plan_features(plan text not null check(plan in('free','basic','pro')),feature text not null,allowed boolean not null,primary key(plan,feature));
insert into public.plan_features select p.plan,f.feature,(p.plan='pro') from (values('free'),('basic'),('pro'))p(plan) cross join (values('whatsapp_share'),('payment_reminders'),('team'),('lead_pipeline'),('custom_logo'),('multi_currency'),('premium_designs'),('gstr1_export'))f(feature) on conflict(plan,feature) do update set allowed=excluded.allowed;
create table if not exists public.usage_counters(workspace_id text not null,resource text not null check(resource in('invoices','quotations','expenses')),month date not null,used_count int not null default 0 check(used_count>=0),primary key(workspace_id,resource,month));
create table if not exists public.plan_rejections(id bigint generated always as identity primary key,workspace_id text,resource text not null,plan text not null,max_count int,reason text not null,occurred_at timestamptz not null default clock_timestamp(),actor_id uuid);
alter table public.plan_rejections enable row level security; revoke all on public.plan_rejections from anon,authenticated;
create or replace function public.ist_month_start(p_at timestamptz default clock_timestamp()) returns date language sql stable set search_path=pg_catalog as $$select date_trunc('month',p_at at time zone 'Asia/Kolkata')::date$$;
create or replace function public.current_plan(p_workspace_id text) returns text language sql stable security definer set search_path=public,pg_temp as $$
select coalesce((select s.tier::text from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at>clock_timestamp() and s.started_at<=clock_timestamp() and s.tier::text in('basic','pro') order by s.expires_at desc,s.created_at desc limit 1),'free')$$;
revoke all on function public.current_plan(text) from public,anon; grant execute on function public.current_plan(text) to authenticated,service_role;
alter table public.invoices add column if not exists client_id uuid; alter table public.quotations add column if not exists client_id uuid; alter table public.clients add column if not exists client_id uuid; alter table public.stock add column if not exists client_id uuid; alter table public.leads add column if not exists client_id uuid; alter table public.expenses add column if not exists client_id uuid; alter table public.services add column if not exists client_id uuid;
create unique index if not exists invoices_ws_client_id_uq on public.invoices(workspace_id,client_id) where client_id is not null;
create unique index if not exists quotations_ws_client_id_uq on public.quotations(workspace_id,client_id) where client_id is not null;
create unique index if not exists clients_ws_client_id_uq on public.clients(workspace_id,client_id) where client_id is not null;
create unique index if not exists stock_ws_client_id_uq on public.stock(workspace_id,client_id) where client_id is not null;
create unique index if not exists leads_ws_client_id_uq on public.leads(workspace_id,client_id) where client_id is not null;
create unique index if not exists expenses_ws_client_id_uq on public.expenses(workspace_id,client_id) where client_id is not null;
create unique index if not exists services_ws_client_id_uq on public.services(workspace_id,client_id) where client_id is not null;
insert into public.usage_counters select workspace_id,'invoices',public.ist_month_start(),count(*)::int from public.invoices where created_at>=public.ist_month_start()::timestamp at time zone 'Asia/Kolkata' group by workspace_id on conflict(workspace_id,resource,month) do update set used_count=greatest(public.usage_counters.used_count,excluded.used_count);
insert into public.usage_counters select workspace_id,'quotations',public.ist_month_start(),count(*)::int from public.quotations where created_at>=public.ist_month_start()::timestamp at time zone 'Asia/Kolkata' group by workspace_id on conflict(workspace_id,resource,month) do update set used_count=greatest(public.usage_counters.used_count,excluded.used_count);
insert into public.usage_counters select workspace_id,'expenses',public.ist_month_start(),count(*)::int from public.expenses where created_at>=public.ist_month_start()::timestamp at time zone 'Asia/Kolkata' group by workspace_id on conflict(workspace_id,resource,month) do update set used_count=greatest(public.usage_counters.used_count,excluded.used_count);

create or replace function public.enforce_plan_limit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ws text; v_plan text; v_resource text:=tg_argv[0]; v_period text; v_limit int; v_used int; v_month date:=public.ist_month_start(); v_dup boolean;
begin
 if auth.role()='service_role' then v_ws:=new.workspace_id; else select p.workspace_id into v_ws from public.profiles p where p.id=auth.uid(); if v_ws is null then raise exception using errcode='42501',message='WORKSPACE_REQUIRED'; end if; end if;
 new.workspace_id:=v_ws; new.created_at:=clock_timestamp();
 if tg_table_name='workspace_members' then new.owner_id:=coalesce(auth.uid(),new.owner_id); end if;
 v_plan:=public.current_plan(v_ws);
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
drop trigger if exists plan_limit_invoices on public.invoices; create trigger plan_limit_invoices before insert on public.invoices for each row execute function public.enforce_plan_limit('invoices');
drop trigger if exists plan_limit_quotations on public.quotations; create trigger plan_limit_quotations before insert on public.quotations for each row execute function public.enforce_plan_limit('quotations');
drop trigger if exists plan_limit_clients on public.clients; create trigger plan_limit_clients before insert on public.clients for each row execute function public.enforce_plan_limit('clients');
drop trigger if exists plan_limit_stock on public.stock; create trigger plan_limit_stock before insert on public.stock for each row execute function public.enforce_plan_limit('stock');
drop trigger if exists plan_limit_leads on public.leads; create trigger plan_limit_leads before insert on public.leads for each row execute function public.enforce_plan_limit('leads');
drop trigger if exists plan_limit_expenses on public.expenses; create trigger plan_limit_expenses before insert on public.expenses for each row execute function public.enforce_plan_limit('expenses');
drop trigger if exists plan_limit_services on public.services; create trigger plan_limit_services before insert on public.services for each row execute function public.enforce_plan_limit('services');
drop trigger if exists plan_limit_workspace_members on public.workspace_members; create trigger plan_limit_workspace_members before insert on public.workspace_members for each row execute function public.enforce_plan_limit('team_members');

create or replace function public.protect_server_fields() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.workspace_id is distinct from old.workspace_id or new.created_at is distinct from old.created_at then raise exception using errcode='42501',message='IMMUTABLE_SERVER_FIELDS'; end if;
 if tg_table_name='invoices' and new.created_by is distinct from old.created_by then raise exception using errcode='42501',message='IMMUTABLE_SERVER_FIELDS'; end if;
 if tg_table_name='workspace_members' and new.owner_id is distinct from old.owner_id then raise exception using errcode='42501',message='IMMUTABLE_SERVER_FIELDS'; end if;
 return new;
end $$;
do $$ declare t text; begin foreach t in array array['invoices','quotations','clients','stock','leads','expenses','services','workspace_members'] loop execute format('drop trigger if exists protect_server_fields_%I on public.%I',t,t); execute format('create trigger protect_server_fields_%I before update on public.%I for each row execute function public.protect_server_fields()',t,t); end loop; end $$;
create or replace function public.plan_feature_allowed(p_workspace_id text,p_feature text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select coalesce((select allowed from public.plan_features where plan=public.current_plan(p_workspace_id) and feature=p_feature),false)$$;
revoke all on function public.plan_feature_allowed(text,text) from public,anon; grant execute on function public.plan_feature_allowed(text,text) to authenticated,service_role;
commit;
