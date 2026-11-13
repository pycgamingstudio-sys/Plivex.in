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

create or replace function public.record_invoice_share_view(share_link_id uuid)
returns void language sql security definer set search_path = public
as $$ update public.invoice_share_links set view_count=view_count+1,last_viewed_at=now() where id=share_link_id and revoked_at is null and expires_at>now(); $$;
create or replace function public.increment_invoice_share_download(share_link_id uuid)
returns void language sql security definer set search_path = public
as $$ update public.invoice_share_links set download_count=download_count+1 where id=share_link_id and revoked_at is null and expires_at>now(); $$;
revoke all on function public.record_invoice_share_view(uuid) from public, anon, authenticated;
revoke all on function public.increment_invoice_share_download(uuid) from public, anon, authenticated;
grant execute on function public.record_invoice_share_view(uuid) to service_role;
grant execute on function public.increment_invoice_share_download(uuid) to service_role;
