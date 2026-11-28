-- Stage 2 governance: allow employees to work only their own CRM leads.
-- Manager/admin policies remain unchanged; employees cannot delete leads or manage clients.
begin;

drop policy if exists "leads employee insert own" on public.leads;
create policy "leads employee insert own"
on public.leads
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and has_ws_role(workspace_id, array['employee'::app_role])
);

drop policy if exists "leads employee update own" on public.leads;
create policy "leads employee update own"
on public.leads
for update
to authenticated
using (
  owner_id = (select auth.uid())
  and has_ws_role(workspace_id, array['employee'::app_role])
)
with check (
  owner_id = (select auth.uid())
  and has_ws_role(workspace_id, array['employee'::app_role])
);

drop policy if exists "lead activities employee insert own" on public.lead_activities;
create policy "lead activities employee insert own"
on public.lead_activities
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and has_ws_role(workspace_id, array['employee'::app_role])
  and exists (
    select 1
    from public.leads l
    where l.id = lead_id
      and l.workspace_id = workspace_id
      and l.owner_id = (select auth.uid())
  )
);

commit;
