-- Global inventory ledger writes with atomic stock balance updates.
-- All mutations are service-role RPC only and require an active workspace role.
begin;

alter table global.stock_movements
  add column if not exists idempotency_key uuid;

create unique index if not exists global_stock_movements_workspace_idempotency_uidx
  on global.stock_movements(workspace_id, idempotency_key)
  where idempotency_key is not null;

create or replace function global.ensure_product_stock_level()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
begin
  insert into global.stock_levels(workspace_id, product_id, quantity, reorder_level)
  values (new.workspace_id, new.id, 0, 0)
  on conflict (workspace_id, product_id) do nothing;
  return new;
end;
$function$;

drop trigger if exists global_products_create_stock_level on global.products;
create trigger global_products_create_stock_level
  after insert on global.products
  for each row execute function global.ensure_product_stock_level();

insert into global.stock_levels(workspace_id, product_id, quantity, reorder_level)
select p.workspace_id, p.id, 0, 0
from global.products p
on conflict (workspace_id, product_id) do nothing;

create or replace function public.global_record_stock_movement(
  p_user_id uuid,
  p_workspace_id uuid,
  p_product_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_notes text default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_current numeric(18,4);
  v_next numeric(18,4);
  v_existing global.stock_movements%rowtype;
  v_movement global.stock_movements%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or p_product_id is null
     or p_idempotency_key is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if p_movement_type not in ('opening','receipt','sale','return','adjustment')
     or p_quantity_delta is null
     or p_quantity_delta = 0
     or abs(p_quantity_delta) > 1000000000000
     or p_quantity_delta <> round(p_quantity_delta, 4)
     or (p_movement_type in ('opening','receipt','return') and p_quantity_delta < 0)
     or (p_movement_type = 'sale' and p_quantity_delta > 0)
     or (p_movement_type = 'adjustment' and p_quantity_delta = 0) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_movement');
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_notes');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_idempotency_key::text, 0));

  select wm.role into v_role
  from global.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_user_id
    and wm.status = 'active'
  limit 1;
  if v_role is null then
    return jsonb_build_object('ok', false, 'reason', 'access_denied');
  end if;
  if v_role not in ('owner','admin','manager','storekeeper') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_existing
  from global.stock_movements
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.product_id <> p_product_id
       or v_existing.movement_type <> p_movement_type
       or v_existing.quantity_delta <> p_quantity_delta then
      return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
    end if;
    select quantity into v_current from global.stock_levels
      where workspace_id = p_workspace_id and product_id = p_product_id;
    return jsonb_build_object('ok', true, 'duplicate', true,
      'movement_id', v_existing.id, 'quantity', coalesce(v_current,0));
  end if;

  if not exists (
    select 1 from global.products p
    where p.workspace_id = p_workspace_id and p.id = p_product_id and p.is_active
  ) then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  insert into global.stock_levels(workspace_id, product_id, quantity, reorder_level)
  values (p_workspace_id, p_product_id, 0, 0)
  on conflict (workspace_id, product_id) do nothing;

  select quantity into v_current
  from global.stock_levels
  where workspace_id = p_workspace_id and product_id = p_product_id
  for update;
  v_next := v_current + p_quantity_delta;
  if v_next < 0 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_stock',
      'available', v_current);
  end if;

  insert into global.stock_movements(
    workspace_id, product_id, movement_type, quantity_delta,
    notes, created_by, idempotency_key
  ) values (
    p_workspace_id, p_product_id, p_movement_type, p_quantity_delta,
    nullif(trim(p_notes),''), p_user_id, p_idempotency_key
  ) returning * into v_movement;

  update global.stock_levels
  set quantity = v_next, updated_at = now()
  where workspace_id = p_workspace_id and product_id = p_product_id;

  return jsonb_build_object('ok', true, 'duplicate', false,
    'movement_id', v_movement.id, 'quantity', v_next);
end;
$function$;

revoke all on function public.global_record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid)
  from public, anon, authenticated;
grant execute on function public.global_record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid)
  to service_role;

revoke all on function global.ensure_product_stock_level() from public, anon, authenticated;
grant execute on function global.ensure_product_stock_level() to service_role;

comment on function public.global_record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid) is
  'Service-role-only atomic Global stock movement. Revalidates active membership, role, product, nonnegative balance and idempotency.';
commit;
