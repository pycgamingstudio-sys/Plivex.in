alter table public.invoices
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_hold boolean not null default false,
  add column if not exists reminder_schedule_version integer not null default 1,
  add column if not exists reminder_language text not null default 'en';

create table if not exists public.invoice_reminder_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  schedule_version integer not null default 1,
  stage text not null check (stage in ('before_due_2','due_date','overdue_3','overdue_7','overdue_15')),
  scheduled_for date not null,
  status text not null default 'scheduled' check (status in ('scheduled','on_hold','sending','sent','failed','cancelled')),
  recipient_email text,
  sent_at timestamptz,
  provider_message_id text,
  failure_reason text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_reminder_events_invoice_version_stage_key unique (invoice_id, schedule_version, stage)
);

create index if not exists invoice_reminder_events_due_idx
  on public.invoice_reminder_events (status, scheduled_for)
  where status in ('scheduled','failed','on_hold');

create index if not exists invoice_reminder_events_workspace_idx
  on public.invoice_reminder_events (workspace_id, created_at desc);

alter table public.invoice_reminder_events enable row level security;

drop policy if exists "invoice reminder events read workspace" on public.invoice_reminder_events;
create policy "invoice reminder events read workspace"
  on public.invoice_reminder_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.workspace_id = invoice_reminder_events.workspace_id
    )
  );

revoke insert, update, delete on public.invoice_reminder_events from anon, authenticated;
grant select on public.invoice_reminder_events to authenticated;
grant all on public.invoice_reminder_events to service_role;
