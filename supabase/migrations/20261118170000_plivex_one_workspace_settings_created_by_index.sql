-- Cover the workspace_settings.created_by foreign key for efficient user lookups.
create index if not exists workspace_settings_created_by_idx
  on public.workspace_settings(created_by);
