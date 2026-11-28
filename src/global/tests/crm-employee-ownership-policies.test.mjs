import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../../../supabase/migrations/20261128170000_stage2_crm_employee_ownership_policies.sql", import.meta.url);

test("employee CRM insert and update policies are restricted to the authenticated owner", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /create policy "leads employee insert own"[\s\S]*owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /create policy "leads employee update own"[\s\S]*using \([\s\S]*owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /with check \([\s\S]*owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /has_ws_role\(workspace_id, array\['employee'::app_role\]\)/i);
});

test("employee activity creation is limited to their own leads and own actor identity", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /create policy "lead activities employee insert own"[\s\S]*created_by = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /l\.workspace_id = workspace_id[\s\S]*l\.owner_id = \(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(sql, /for delete[\s\S]*to authenticated/i);
});
