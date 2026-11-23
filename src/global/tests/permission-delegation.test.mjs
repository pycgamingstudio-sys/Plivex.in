import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261123014000_global_permission_delegation.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../../../supabase/functions/global-enterprise/index.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../../components/global/GlobalEnterprisePanel.jsx", import.meta.url), "utf8");

test("permission delegations are workspace-scoped, time-bound and private", () => {
  assert.match(migration, /create table if not exists global\.workspace_permission_delegations/);
  assert.match(migration, /expires_at<=starts_at\+interval '90 days'/);
  assert.match(migration, /alter table global\.workspace_permission_delegations enable row level security/);
  assert.match(migration, /revoke all on global\.workspace_permission_delegations from public,anon,authenticated/);
  assert.match(migration, /grant all on global\.workspace_permission_delegations to service_role/);
  assert.match(migration, /status='active' and d\.starts_at<=now\(\) and d\.expires_at>now\(\)/);
});

test("delegated grants apply to enterprise and approval permissions while explicit overrides retain priority", () => {
  assert.match(migration, /global\.has_active_permission_delegation/);
  assert.match(migration, /if v_override is null and global\.has_active_permission_delegation/);
  assert.match(migration, /global\.has_active_permission_delegation\(p_workspace_id,v_member\.id,'audit\.read'\)/);
  assert.match(migration, /global_permission_delegation_create/);
  assert.match(migration, /global_permission_delegation_list/);
  assert.match(migration, /global_permission_delegation_revoke/);
  assert.match(migration, /permission\.delegation\.created/);
  assert.match(migration, /permission\.delegation\.revoked/);
});

test("Edge Function validates and routes delegation operations through service-role RPCs", () => {
  assert.match(edge, /permission\.delegation\.create/);
  assert.match(edge, /permission\.delegation\.list/);
  assert.match(edge, /permission\.delegation\.revoke/);
  assert.match(edge, /DELEGATABLE_PERMISSIONS/);
  assert.match(edge, /global_permission_delegation_create/);
  assert.match(edge, /global_permission_delegation_list/);
  assert.match(edge, /global_permission_delegation_revoke/);
  assert.match(edge, /90 \* 24 \* 60 \* 60 \* 1000/);
});

test("Enterprise UI supports creating, reviewing and revoking time-bound delegations", () => {
  assert.match(panel, /Time-bound permission delegation/);
  assert.match(panel, /Delegated permissions/);
  assert.match(panel, /Create delegation/);
  assert.match(panel, /Revoke delegation/);
  assert.match(panel, /permission\.delegation\.list/);
});
