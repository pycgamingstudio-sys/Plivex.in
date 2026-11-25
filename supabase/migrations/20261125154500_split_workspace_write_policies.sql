begin;

-- Separate write operations from SELECT policies so read access is evaluated
-- once per row and the existing workspace role boundaries remain unchanged.

drop policy if exists global_approval_policies_admin_write on global.approval_policies;
create policy global_approval_policies_admin_insert on global.approval_policies
  for insert to authenticated
  with check (global.is_workspace_admin(workspace_id));
create policy global_approval_policies_admin_update on global.approval_policies
  for update to authenticated
  using (global.is_workspace_admin(workspace_id))
  with check (global.is_workspace_admin(workspace_id));
create policy global_approval_policies_admin_delete on global.approval_policies
  for delete to authenticated
  using (global.is_workspace_admin(workspace_id));

drop policy if exists global_branches_admin_write on global.workspace_branches;
create policy global_branches_admin_insert on global.workspace_branches
  for insert to authenticated
  with check (global.is_workspace_admin(workspace_id));
create policy global_branches_admin_update on global.workspace_branches
  for update to authenticated
  using (global.is_workspace_admin(workspace_id))
  with check (global.is_workspace_admin(workspace_id));
create policy global_branches_admin_delete on global.workspace_branches
  for delete to authenticated
  using (global.is_workspace_admin(workspace_id));

drop policy if exists "purchase orders write" on public.purchase_orders;
create policy "purchase orders insert" on public.purchase_orders
  for insert to authenticated
  with check (has_ws_role(workspace_id, array['admin'::app_role, 'manager'::app_role]));
create policy "purchase orders update" on public.purchase_orders
  for update to authenticated
  using (has_ws_role(workspace_id, array['admin'::app_role, 'manager'::app_role]))
  with check (has_ws_role(workspace_id, array['admin'::app_role, 'manager'::app_role]));
create policy "purchase orders delete" on public.purchase_orders
  for delete to authenticated
  using (has_ws_role(workspace_id, array['admin'::app_role, 'manager'::app_role]));

drop policy if exists "warehouses write" on public.warehouses;
create policy "warehouses insert" on public.warehouses
  for insert to authenticated
  with check (has_ws_role(workspace_id, array['admin'::app_role, 'manager'::app_role]));
create policy "warehouses update" on public.warehouses
  for update to authenticated
  using (has_ws_role(workspace_id, array['admin'::app_role, 'manager'::app_role]))
  with check (has_ws_role(workspace_id, array['admin'::app_role, 'manager'::app_role]));
create policy "warehouses delete" on public.warehouses
  for delete to authenticated
  using (has_ws_role(workspace_id, array['admin'::app_role, 'manager'::app_role]));

commit;
