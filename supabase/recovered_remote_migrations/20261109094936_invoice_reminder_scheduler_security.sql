
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.invoice_reminder_cron_config (
  singleton boolean primary key default true check (singleton),
  secret text not null,
  created_at timestamptz not null default now()
);
alter table public.invoice_reminder_cron_config enable row level security;
revoke all on public.invoice_reminder_cron_config from anon, authenticated;
grant select on public.invoice_reminder_cron_config to service_role;

do $$
declare
  v_secret text;
begin
  if not exists (select 1 from public.invoice_reminder_cron_config where singleton = true) then
    v_secret := encode(gen_random_bytes(32), 'hex');
    insert into public.invoice_reminder_cron_config(singleton, secret) values (true, v_secret);
    perform vault.create_secret(v_secret, 'plivex_invoice_reminder_cron', 'Private authentication token for the Plivex invoice reminder scheduler');
  end if;
end $$;
