-- Defense in depth for Main Workspace platform data.
-- Service-role Edge Functions are the only intended readers/writers.
begin;
create index if not exists document_signing_requested_by_idx on public.document_signing_requests(requested_by);
create index if not exists document_ocr_created_by_idx on public.document_ocr_jobs(created_by);
create index if not exists whatsapp_created_by_idx on public.whatsapp_delivery_logs(created_by);
create index if not exists public_api_keys_created_by_idx on public.public_api_keys(created_by);
create index if not exists workspace_audit_actor_idx on public.workspace_audit_events(actor_id);
do $$
declare t text;
begin
  foreach t in array array['document_signing_requests','document_ocr_jobs','whatsapp_delivery_logs','public_api_keys','workspace_audit_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_deny_client_access', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (false) with check (false)', t || '_deny_client_access', t);
  end loop;
end $$;
commit;
