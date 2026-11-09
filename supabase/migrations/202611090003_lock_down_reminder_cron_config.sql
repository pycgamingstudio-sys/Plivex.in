drop policy if exists "deny public access to reminder cron config" on public.invoice_reminder_cron_config;
create policy "deny public access to reminder cron config"
  on public.invoice_reminder_cron_config
  for all
  to anon, authenticated
  using (false)
  with check (false);
