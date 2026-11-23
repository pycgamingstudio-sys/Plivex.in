-- Main Workspace serial-number traceability across warehouses with auditable lifecycle events.
begin;
create table if not exists public.inventory_serial_units(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 stock_id uuid not null references public.stock(id) on delete restrict,warehouse_id uuid not null references public.warehouses(id) on delete restrict,
 serial_number text not null check(length(btrim(serial_number)) between 2 and 100),batch_number text,
 status text not null default 'in_stock' check(status in ('in_stock','reserved','sold','returned','defective')),
 sold_invoice_id uuid references public.invoices(id) on delete set null,registration_key uuid not null,
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,serial_number),unique(workspace_id,registration_key,serial_number)
);
create table if not exists public.inventory_serial_events(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 serial_unit_id uuid not null references public.inventory_serial_units(id) on delete cascade,event_type text not null,from_status text,to_status text,
 from_warehouse_id uuid,to_warehouse_id uuid,invoice_id uuid references public.invoices(id) on delete set null,
 actor_id uuid references auth.users(id) on delete set null,note text,created_at timestamptz not null default now()
);
create index if not exists inventory_serial_workspace_status_idx on public.inventory_serial_units(workspace_id,status,created_at desc);
create index if not exists inventory_serial_stock_idx on public.inventory_serial_units(workspace_id,stock_id,warehouse_id);
create index if not exists inventory_serial_events_unit_idx on public.inventory_serial_events(workspace_id,serial_unit_id,created_at desc);
alter table public.inventory_serial_units enable row level security;
alter table public.inventory_serial_events enable row level security;
revoke all on public.inventory_serial_units,public.inventory_serial_events from public,anon,authenticated;
grant all on public.inventory_serial_units,public.inventory_serial_events to service_role;
create policy inventory_serial_units_deny_client_access on public.inventory_serial_units for all to anon,authenticated using(false) with check(false);
create policy inventory_serial_events_deny_client_access on public.inventory_serial_events for all to anon,authenticated using(false) with check(false);

create or replace function public.main_workspace_register_inventory_serials(p_workspace_id text,p_stock_id uuid,p_warehouse_id uuid,p_serial_numbers text[],p_batch_number text,p_registration_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_stock public.stock%rowtype;v_warehouse public.warehouses%rowtype;v_serial text;v_id uuid;v_ids jsonb:='[]'::jsonb;v_count integer:=0;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_registration_key is null or p_serial_numbers is null or cardinality(p_serial_numbers)<1 or cardinality(p_serial_numbers)>200 then return jsonb_build_object('ok',false,'reason','invalid_serial_batch'); end if;
 if cardinality(p_serial_numbers)<>(select count(distinct btrim(x)) from unnest(p_serial_numbers) x) then return jsonb_build_object('ok',false,'reason','duplicate_serial_in_batch'); end if;
 select * into v_stock from public.stock where id=p_stock_id and workspace_id=p_workspace_id;if not found then return jsonb_build_object('ok',false,'reason','stock_item_not_found');end if;
 select * into v_warehouse from public.warehouses where id=p_warehouse_id and workspace_id=p_workspace_id and is_active=true;if not found then return jsonb_build_object('ok',false,'reason','warehouse_not_found');end if;
 foreach v_serial in array p_serial_numbers loop
  v_serial:=btrim(v_serial);if length(v_serial)<2 or length(v_serial)>100 then return jsonb_build_object('ok',false,'reason','invalid_serial_number');end if;
  select id into v_id from public.inventory_serial_units where workspace_id=p_workspace_id and registration_key=p_registration_key and serial_number=v_serial;
  if v_id is null then
   insert into public.inventory_serial_units(workspace_id,stock_id,warehouse_id,serial_number,batch_number,registration_key,created_by) values(p_workspace_id,p_stock_id,p_warehouse_id,v_serial,nullif(btrim(p_batch_number),''),p_registration_key,v_user) returning id into v_id;
   insert into public.inventory_serial_events(workspace_id,serial_unit_id,event_type,to_status,to_warehouse_id,actor_id,note) values(p_workspace_id,v_id,'registered','in_stock',p_warehouse_id,v_user,'Initial serial registration');
   v_count:=v_count+1;
  end if;
  v_ids:=v_ids||jsonb_build_array(v_id);
 end loop;
 return jsonb_build_object('ok',true,'created',v_count,'serial_ids',v_ids);
exception when unique_violation then return jsonb_build_object('ok',false,'reason','serial_number_already_registered');
end; $function$;

create or replace function public.main_workspace_list_inventory_serials(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_rows jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'serial_number',s.serial_number,'stock_id',s.stock_id,'stock_name',st.name,'warehouse_id',s.warehouse_id,'warehouse_name',w.name,'batch_number',s.batch_number,'status',s.status,'sold_invoice_id',s.sold_invoice_id,'created_at',s.created_at) order by s.created_at desc),'[]'::jsonb)
 into v_rows from public.inventory_serial_units s join public.stock st on st.id=s.stock_id join public.warehouses w on w.id=s.warehouse_id where s.workspace_id=p_workspace_id;
 return jsonb_build_object('ok',true,'serials',v_rows);
end; $function$;

create or replace function public.main_workspace_update_inventory_serial(p_workspace_id text,p_serial_id uuid,p_new_status text,p_new_warehouse_id uuid,p_invoice_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid();v_serial public.inventory_serial_units%rowtype;v_warehouse public.warehouses%rowtype;v_old_status text;v_old_warehouse uuid;v_event text;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role,'storekeeper'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 select * into v_serial from public.inventory_serial_units where workspace_id=p_workspace_id and id=p_serial_id for update;if not found then return jsonb_build_object('ok',false,'reason','serial_not_found');end if;
 v_old_status:=v_serial.status;v_old_warehouse:=v_serial.warehouse_id;
 if p_new_warehouse_id is not null and p_new_warehouse_id<>v_old_warehouse then
  if v_old_status not in ('in_stock','returned') then return jsonb_build_object('ok',false,'reason','serial_not_transferable');end if;
  select * into v_warehouse from public.warehouses where id=p_new_warehouse_id and workspace_id=p_workspace_id and is_active=true;if not found then return jsonb_build_object('ok',false,'reason','warehouse_not_found');end if;
 end if;
 if p_new_status is not null then
  if not ((v_old_status='in_stock' and p_new_status in ('reserved','sold','defective')) or (v_old_status='reserved' and p_new_status in ('in_stock','sold','defective')) or (v_old_status='sold' and p_new_status='returned') or (v_old_status='returned' and p_new_status in ('in_stock','defective')) or (v_old_status='defective' and p_new_status='in_stock' and public.has_ws_role(p_workspace_id,array['admin'::app_role]))) then return jsonb_build_object('ok',false,'reason','invalid_serial_transition');end if;
  if p_new_status='sold' and (p_invoice_id is null or not exists(select 1 from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id and not is_draft and lower(status) not in ('draft','cancelled','void'))) then return jsonb_build_object('ok',false,'reason','issued_invoice_required');end if;
 end if;
 update public.inventory_serial_units set status=coalesce(p_new_status,status),warehouse_id=coalesce(p_new_warehouse_id,warehouse_id),sold_invoice_id=case when p_new_status='sold' then p_invoice_id when p_new_status='returned' then null else sold_invoice_id end,updated_at=now() where id=p_serial_id;
 v_event:=case when p_new_warehouse_id is not null and p_new_warehouse_id<>v_old_warehouse then 'transferred' else coalesce(p_new_status,'updated') end;
 insert into public.inventory_serial_events(workspace_id,serial_unit_id,event_type,from_status,to_status,from_warehouse_id,to_warehouse_id,invoice_id,actor_id,note)
 values(p_workspace_id,p_serial_id,v_event,v_old_status,coalesce(p_new_status,v_old_status),v_old_warehouse,coalesce(p_new_warehouse_id,v_old_warehouse),p_invoice_id,v_user,left(coalesce(p_note,''),500));
 return jsonb_build_object('ok',true);
end; $function$;
revoke all on function public.main_workspace_register_inventory_serials(text,uuid,uuid,text[],text,uuid) from public,anon;
revoke all on function public.main_workspace_list_inventory_serials(text) from public,anon;
revoke all on function public.main_workspace_update_inventory_serial(text,uuid,text,uuid,uuid,text) from public,anon;
grant execute on function public.main_workspace_register_inventory_serials(text,uuid,uuid,text[],text,uuid) to authenticated;
grant execute on function public.main_workspace_list_inventory_serials(text) to authenticated;
grant execute on function public.main_workspace_update_inventory_serial(text,uuid,text,uuid,uuid,text) to authenticated;
commit;
