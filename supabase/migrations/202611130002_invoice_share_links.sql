create table if not exists public.invoice_share_links (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  workspace_id text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  download_count integer not null default 0
);
create index if not exists invoice_share_links_invoice_id_idx on public.invoice_share_links(invoice_id);
create index if not exists invoice_share_links_workspace_id_idx on public.invoice_share_links(workspace_id);
alter table public.invoice_share_links enable row level security;
revoke all on public.invoice_share_links from anon, authenticated;
