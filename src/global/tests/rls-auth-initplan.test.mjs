import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261125160000_fix_rls_auth_initplans.sql", import.meta.url), "utf8");

test("RLS auth calls are wrapped in scalar SELECTs to avoid per-row re-evaluation", () => {
  assert.match(migration, /requested_by = \(select auth\.uid\(\)\)/);
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/);
  assert.match(migration, /global\.is_workspace_admin\(workspace_id\)/);
  assert.match(migration, /has_ws_role\(workspace_id/);
});
