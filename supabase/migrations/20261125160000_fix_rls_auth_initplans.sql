begin;

drop policy if exists global_exports_owner_read on global.export_jobs;
create policy global_exports_owner_read on global.export_jobs
  for select to authenticated
  using ((requested_by = (select auth.uid())) or global.is_workspace_admin(workspace_id));

drop policy if exists "lead activities insert" on public.lead_activities;
create policy "lead activities insert" on public.lead_activities
  for insert to authenticated
  with check (
    has_ws_role(workspace_id, array['admin'::app_role, 'manager'::app_role])
    and created_by = (select auth.uid())
  );

commit;
