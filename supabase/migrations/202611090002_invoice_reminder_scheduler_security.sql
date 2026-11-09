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

select cron.schedule(
  'plivex-invoice-reminder-sweep',
  '0 3 * * *',
  $job$
    select net.http_post(
      url := 'https://sqzpaiibmfsvarrkwkvb.supabase.co/functions/v1/sweep-invoice-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'plivex_invoice_reminder_cron')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);
