-- PLIVEX ONE: force legacy workspaces through the same verified onboarding once.
begin;

alter table public.workspace_settings
  add column if not exists onboarding_version smallint not null default 0
    check (onboarding_version between 0 and 1);

alter table public.workspace_settings
  add column if not exists migration_status text not null default 'legacy_pending'
    check (migration_status in ('legacy_pending','review_required','ready'));

alter table public.workspace_settings
  add column if not exists onboarding_completed_at timestamptz;

alter table public.workspace_settings
  add column if not exists legacy_review_required boolean not null default false;

-- Rows that predate this rollout are intentionally pending, even when they
-- already contain country and work-profile values. Monetary records are not
-- rewritten here; their stored currency remains historical truth.
update public.workspace_settings
set onboarding_version = 0,
    migration_status = case when legacy_review_required then 'review_required' else 'legacy_pending' end,
    onboarding_completed_at = null,
    updated_at = now()
where onboarding_version < 1;

create index if not exists workspace_settings_onboarding_status_idx
  on public.workspace_settings(migration_status, onboarding_version);

comment on column public.workspace_settings.onboarding_version is
  'Version of the mandatory single-Workspace onboarding completed by the workspace owner. Existing workspaces are version 0 until explicitly reviewed.';
comment on column public.workspace_settings.migration_status is
  'legacy_pending blocks app access until owner review; review_required blocks access for ambiguous legacy mappings; ready permits normal access.';
comment on column public.workspace_settings.legacy_review_required is
  'Set when historical country or data mapping is ambiguous. Never infer or rewrite historical currency to clear this flag.';

commit;
