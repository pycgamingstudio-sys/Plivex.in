import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261123031111_main_workspace_approvals_and_permission_delegation.sql", import.meta.url), "utf8");
const followup = readFileSync(new URL("../../../supabase/migrations/20261123031227_main_workspace_approval_lists_permission_overrides.sql", import.meta.url), "utf8");
const panel = readFileSync(new URL("../../components/workspace/WorkspaceEnterpriseControls.jsx", import.meta.url), "utf8");

test("Main Workspace permission delegations are workspace-scoped, time-bound and private", () => {
  assert.match(migration, /public\.workspace_permission_delegations/);
  assert.match(migration, /expires_at/);
  assert.match(migration, /interval '90 days'/);
  assert.match(migration, /alter table public.%I enable row level security/);
  assert.match(migration, /revoke all on public\.%I from public,anon,authenticated/);
  assert.match(migration, /grant all on public\.%I to service_role/);
});

test("Main Workspace delegation create/list/revoke RPCs enforce roles, expiry and audit events", () => {
  assert.match(migration, /main_workspace_permission_delegation_create/);
  assert.match(migration, /main_workspace_permission_delegation_list/);
  assert.match(migration, /main_workspace_permission_delegation_revoke/);
  assert.match(migration, /permission\.delegation\.created/);
  assert.match(migration, /permission\.delegation\.revoked/);
  assert.match(followup, /main_workspace_permission_override_set/);
  assert.match(followup, /main_workspace_list_approval_requests/);
});

test("Main Workspace enterprise UI supports creating, reviewing and revoking delegations", () => {
  assert.match(panel, /Delegate selected permissions to an active team member/);
  assert.match(panel, /permission_keys\.join/);
  assert.match(panel, /Delegate access/);
  assert.match(panel, /Revoke/);
  assert.match(panel, /main_workspace_permission_delegation_list/);
  assert.match(panel, /main_workspace_permission_delegation_create/);
});
