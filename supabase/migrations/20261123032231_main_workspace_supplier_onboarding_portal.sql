-- Main Workspace supplier onboarding with single-use invitation tokens.
begin;
create table if not exists public.suppliers(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 supplier_name text not null check(length(btrim(supplier_name)) between 2 and 200),
 contact_email text not null check(length(btrim(contact_email)) between 3 and 254),phone text,tax_country_code text,tax_id text,
 address jsonb not null default '{}'::jsonb check(jsonb_typeof(address)='object'),payment_terms text,
 status text not null default 'invited' check(status in ('invited','submitted','approved','rejected','archived')),
 submitted_at timestamptz,reviewed_by uuid references auth.users(id) on delete set null,reviewed_at timestamptz,review_note text,
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,contact_email)
);
create table if not exists public.supplier_invitation_tokens(
 id uuid primary key default gen_random_uuid(),workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
 supplier_id uuid not null references public.suppliers(id) on delete cascade,token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null,used_at timestamptz,revoked_at timestamptz,created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create unique index if not exists supplier_one_active_invite_idx on public.supplier_invitation_tokens(supplier_id) where used_at is null and revoked_at is null;
create index if not exists suppliers_workspace_status_idx on public.suppliers(workspace_id,status,created_at desc);
create index if not exists supplier_invites_workspace_idx on public.supplier_invitation_tokens(workspace_id,created_at desc);
alter table public.suppliers enable row level security;
alter table public.supplier_invitation_tokens enable row level security;
revoke all on public.suppliers,public.supplier_invitation_tokens from public,anon,authenticated;
grant all on public.suppliers,public.supplier_invitation_tokens to service_role;
create policy suppliers_deny_client_access on public.suppliers for all to anon,authenticated using(false) with check(false);
create policy supplier_invitation_tokens_deny_client_access on public.supplier_invitation_tokens for all to anon,authenticated using(false) with check(false);
commit;
