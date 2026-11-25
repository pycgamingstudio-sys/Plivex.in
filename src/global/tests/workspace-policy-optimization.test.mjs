import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261125154500_split_workspace_write_policies.sql", import.meta.url), "utf8");

test("workspace policy optimization removes overlapping ALL policies without dropping SELECT policies", () => {
  assert.match(migration, /drop policy if exists global_approval_policies_admin_write/);
  assert.match(migration, /drop policy if exists global_branches_admin_write/);
  assert.match(migration, /drop policy if exists "purchase orders write"/);
  assert.match(migration, /drop policy if exists "warehouses write"/);
  assert.doesNotMatch(migration, /drop policy if exists[^;]*(?:admin_read|member_read|orders read|warehouses read)/i);
  assert.doesNotMatch(migration, /create policy[^;]*for all/i);
});

test("workspace policy writes remain role-scoped for insert, update and delete", () => {
  for (const operation of ["insert", "update", "delete"]) {
    assert.match(migration, new RegExp("for " + operation + " to authenticated", "i"));
  }
  assert.match(migration, /global\.is_workspace_admin\(workspace_id\)/);
  assert.match(migration, /has_ws_role\(workspace_id, array\['admin'::app_role, 'manager'::app_role\]\)/);
});
