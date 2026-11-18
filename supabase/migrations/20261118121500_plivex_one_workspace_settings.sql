-- PLIVEX ONE: canonical country-aware settings for the single public workspace identity.
begin;

create table if not exists public.workspace_settings (
  workspace_id text primary key,
  country_code text not null,
  locale_code text not null,
  currency_code text not null,
  workspace_type text not null
    check (workspace_type in ('freelancer','business')),
  optional_features text[] not null default '{}'::text[],
  phone_country_code text,
  phone_number text,
  settings_version integer not null default 1 check (settings_version > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_settings_country_currency_check check (
    (country_code = 'IN' and currency_code = 'INR' and locale_code in ('en-IN','hi-IN'))
    or (country_code = 'US' and currency_code = 'USD' and locale_code in ('en-US','es-US'))
    or (country_code = 'GB' and currency_code = 'GBP' and locale_code = 'en-GB')
    or (country_code = 'AE' and currency_code = 'AED' and locale_code in ('en-AE','ar-AE'))
    or (country_code = 'CA' and currency_code = 'CAD' and locale_code in ('en-CA','fr-CA'))
    or (country_code = 'AU' and currency_code = 'AUD' and locale_code = 'en-AU')
    or (country_code = 'SG' and currency_code = 'SGD' and locale_code in ('en-SG','zh-SG','ms-SG','ta-SG'))
  ),
  constraint workspace_settings_phone_country_code_check check (
    phone_country_code is null or phone_country_code ~ '^\+[1-9][0-9]{0,3}$'
  ),
  constraint workspace_settings_phone_number_check check (
    phone_number is null or length(phone_number) between 3 and 32
  ),
  constraint workspace_settings_optional_features_check check (
    optional_features <@ array['expenses','crm','leads','inventoryWorkspace','reports']::text[]
  )
);

create index if not exists workspace_settings_country_idx
  on public.workspace_settings(country_code, currency_code);

alter table public.workspace_settings enable row level security;

drop policy if exists "workspace settings read members" on public.workspace_settings;
create policy "workspace settings read members"
  on public.workspace_settings for select to authenticated
  using (has_ws_role(workspace_id, array['admin'::app_role,'manager'::app_role,'employee'::app_role,'accountant'::app_role,'storekeeper'::app_role]));

drop policy if exists "workspace settings insert admins" on public.workspace_settings;
create policy "workspace settings insert admins"
  on public.workspace_settings for insert to authenticated
  with check (has_ws_role(workspace_id, array['admin'::app_role]));

drop policy if exists "workspace settings update admins" on public.workspace_settings;
create policy "workspace settings update admins"
  on public.workspace_settings for update to authenticated
  using (has_ws_role(workspace_id, array['admin'::app_role]))
  with check (has_ws_role(workspace_id, array['admin'::app_role]));

grant select, insert, update on public.workspace_settings to authenticated;
grant all on public.workspace_settings to service_role;

-- Backfill only explicitly country-stamped workspaces. Never infer India from missing data.
insert into public.workspace_settings (
  workspace_id, country_code, locale_code, currency_code, workspace_type, created_at, updated_at
)
select
  bp.workspace_id,
  bp.country_code,
  bp.locale_code,
  case bp.country_code
    when 'IN' then 'INR'
    when 'US' then 'USD'
    when 'GB' then 'GBP'
    when 'AE' then 'AED'
    when 'CA' then 'CAD'
    when 'AU' then 'AUD'
    when 'SG' then 'SGD'
  end,
  'business',
  now(),
  now()
from public.business_profile bp
where
  (bp.country_code = 'IN' and bp.locale_code in ('en-IN','hi-IN'))
  or (bp.country_code = 'US' and bp.locale_code in ('en-US','es-US'))
  or (bp.country_code = 'GB' and bp.locale_code = 'en-GB')
  or (bp.country_code = 'AE' and bp.locale_code in ('en-AE','ar-AE'))
  or (bp.country_code = 'CA' and bp.locale_code in ('en-CA','fr-CA'))
  or (bp.country_code = 'AU' and bp.locale_code = 'en-AU')
  or (bp.country_code = 'SG' and bp.locale_code in ('en-SG','zh-SG','ms-SG','ta-SG'))
on conflict (workspace_id) do nothing;

-- Preserve the workspace's base currency on every monetary record type.
alter table public.expenses add column if not exists currency_code text;
alter table public.stock add column if not exists currency_code text;
alter table public.services add column if not exists currency_code text;
alter table public.leads add column if not exists currency_code text;
alter table public.quotations add column if not exists currency_code text;
alter table public.purchase_orders add column if not exists currency_code text;
alter table public.purchase_order_items add column if not exists currency_code text;

alter table public.expenses drop constraint if exists expenses_currency_code_check;
alter table public.expenses add constraint expenses_currency_code_check check (currency_code is null or currency_code ~ '^[A-Z]{3}$');
alter table public.stock drop constraint if exists stock_currency_code_check;
alter table public.stock add constraint stock_currency_code_check check (currency_code is null or currency_code ~ '^[A-Z]{3}$');
alter table public.services drop constraint if exists services_currency_code_check;
alter table public.services add constraint services_currency_code_check check (currency_code is null or currency_code ~ '^[A-Z]{3}$');
alter table public.leads drop constraint if exists leads_currency_code_check;
alter table public.leads add constraint leads_currency_code_check check (currency_code is null or currency_code ~ '^[A-Z]{3}$');
alter table public.quotations drop constraint if exists quotations_currency_code_check;
alter table public.quotations add constraint quotations_currency_code_check check (currency_code is null or currency_code ~ '^[A-Z]{3}$');
alter table public.purchase_orders drop constraint if exists purchase_orders_currency_code_check;
alter table public.purchase_orders add constraint purchase_orders_currency_code_check check (currency_code is null or currency_code ~ '^[A-Z]{3}$');
alter table public.purchase_order_items drop constraint if exists purchase_order_items_currency_code_check;
alter table public.purchase_order_items add constraint purchase_order_items_currency_code_check check (currency_code is null or currency_code ~ '^[A-Z]{3}$');

update public.expenses t set currency_code = s.currency_code from public.workspace_settings s
  where t.workspace_id = s.workspace_id and t.currency_code is null;
update public.stock t set currency_code = s.currency_code from public.workspace_settings s
  where t.workspace_id = s.workspace_id and t.currency_code is null;
update public.services t set currency_code = s.currency_code from public.workspace_settings s
  where t.workspace_id = s.workspace_id and t.currency_code is null;
update public.leads t set currency_code = s.currency_code from public.workspace_settings s
  where t.workspace_id = s.workspace_id and t.currency_code is null;
update public.quotations t set currency_code = s.currency_code from public.workspace_settings s
  where t.workspace_id = s.workspace_id and t.currency_code is null;
update public.purchase_orders t set currency_code = s.currency_code from public.workspace_settings s
  where t.workspace_id = s.workspace_id and t.currency_code is null;
update public.purchase_order_items t set currency_code = o.currency_code
  from public.purchase_orders o where t.purchase_order_id = o.id and t.workspace_id = o.workspace_id
    and t.currency_code is null;

create or replace function public.india_part4_create_purchase_order(
  p_supplier_name text,
  p_items jsonb,
  p_supplier_reference text default null,
  p_expected_date date default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_workspace text;
  v_user uuid := auth.uid();
  v_order public.purchase_orders%rowtype;
  v_item jsonb;
  v_currency text;
begin
  if v_user is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select workspace_id into v_workspace from public.profiles where id=v_user;
  if v_workspace is null or not has_ws_role(v_workspace,array['admin'::app_role,'manager'::app_role]) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  select currency_code into v_currency from public.workspace_settings where workspace_id=v_workspace;
  if v_currency is null then return jsonb_build_object('ok',false,'reason','workspace_currency_unconfigured'); end if;
  if nullif(trim(p_supplier_name),'') is null or length(p_supplier_name)>200
    or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>200 then
    return jsonb_build_object('ok',false,'reason','invalid_purchase_order');
  end if;
  insert into public.purchase_orders(workspace_id,supplier_name,supplier_reference,status,expected_date,notes,created_by,currency_code)
    values(v_workspace,trim(p_supplier_name),nullif(trim(p_supplier_reference),''),'ordered',p_expected_date,nullif(trim(p_notes),''),v_user,v_currency)
    returning * into v_order;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(v_item->>'stock_id','') is null or coalesce((v_item->>'quantity_ordered')::numeric,0)<=0
      or coalesce((v_item->>'unit_cost')::numeric,-1)<0
      or round((v_item->>'quantity_ordered')::numeric,4)<>(v_item->>'quantity_ordered')::numeric then
      raise exception 'invalid_purchase_order_item';
    end if;
    if not exists(select 1 from public.stock where workspace_id=v_workspace and id=(v_item->>'stock_id')::uuid) then
      raise exception 'stock_item_not_found';
    end if;
    insert into public.purchase_order_items(workspace_id,purchase_order_id,stock_id,quantity_ordered,unit_cost,currency_code)
      values(v_workspace,v_order.id,(v_item->>'stock_id')::uuid,(v_item->>'quantity_ordered')::numeric,(v_item->>'unit_cost')::numeric,v_currency);
  end loop;
  return jsonb_build_object('ok',true,'purchase_order_id',v_order.id,'currency_code',v_currency);
exception when others then
  if sqlerrm in ('invalid_purchase_order_item','stock_item_not_found') then
    return jsonb_build_object('ok',false,'reason',sqlerrm);
  end if;
  raise;
end $function$;

-- SECURITY DEFINER RPC is callable only by authenticated workspace members.
revoke all on function public.india_part4_create_purchase_order(text, jsonb, text, date, text) from public, anon;
grant execute on function public.india_part4_create_purchase_order(text, jsonb, text, date, text) to authenticated, service_role;

comment on table public.workspace_settings is
  'PLIVEX ONE canonical country, currency, primary work profile and optional-feature settings for a public workspace. Country is explicitly selected; no IP or locale inference.';
comment on column public.workspace_settings.optional_features is
  'Optional dashboard/navigation modules. Removing an item never deletes its business records.';
comment on column public.workspace_settings.workspace_type is
  'Primary workspace profile selected during first-time onboarding: freelancer or business.';

commit;
