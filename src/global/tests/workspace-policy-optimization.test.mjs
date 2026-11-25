import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261125154500_split_workspace_write_policies.sql", import.meta.url), "utf8");

test("workspace policy optimization preserves SELECT policies and removes overlapping ALL policies", () => {
  assert.match(migration, /global_approval_policies_admin_read/);
  assert.match(migration, /global_branches_member_read/);
  assert.match(migration, /purchase orders read/);
  assert.match(migration, /warehouses read/);
  assert.doesNotMatch(migration, /create policy[^;]*for all/i);
});

test("workspace policy writes remain role-scoped for insert, update and delete", () => {
  for (const operation of ["insert", "update", "delete"]) {
    assert.match(migration, new RegExp("for " + operation + " to authenticated", "i"));
  }
  assert.match(migration, /global\.is_workspace_admin\(workspace_id\)/);
  assert.match(migration, /has_ws_role\(workspace_id, array\['admin'::app_role, 'manager'::app_role\]\)/);
});
