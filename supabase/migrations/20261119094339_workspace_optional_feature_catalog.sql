-- Keep the canonical workspace feature constraint aligned with the UI catalog.
-- Freelancer workspaces may add Stock Inventory and Team Members later from More Features.
-- Business workspaces receive the complete module set by default.
begin;

alter table public.workspace_settings
  drop constraint if exists workspace_settings_optional_features_check;

alter table public.workspace_settings
  add constraint workspace_settings_optional_features_check
  check (
    optional_features <@ array[
      'expenses',
      'crm',
      'leads',
      'reports',
      'stock',
      'team',
      'inventoryWorkspace'
    ]::text[]
  );

update public.workspace_settings
set optional_features = array(
      select distinct feature_id
      from unnest(coalesce(optional_features, '{}'::text[]) || array[
        'expenses',
        'crm',
        'leads',
        'reports',
        'stock',
        'team',
        'inventoryWorkspace'
      ]::text[]) as features(feature_id)
      order by feature_id
    ),
    updated_at = now()
where workspace_type = 'business'
  and optional_features is distinct from array(
    select distinct feature_id
    from unnest(coalesce(optional_features, '{}'::text[]) || array[
      'expenses',
      'crm',
      'leads',
      'reports',
      'stock',
      'team',
      'inventoryWorkspace'
    ]::text[]) as features(feature_id)
    order by feature_id
  );

comment on constraint workspace_settings_optional_features_check
  on public.workspace_settings is
  'Allows every optional dashboard module in the Plivex workspace feature catalog; core invoices and quotations are not stored here.';

commit;
