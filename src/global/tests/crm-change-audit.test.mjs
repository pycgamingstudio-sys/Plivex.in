import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../../../supabase/migrations/20261128180000_stage2_crm_change_audit.sql", import.meta.url);

test("CRM lead lifecycle trigger records actor, target, workspace and outcome", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /add column if not exists correlation_id uuid/i);
  assert.match(sql, /add column if not exists outcome text not null default 'success'/i);
  assert.match(sql, /after insert or update or delete on public\.leads/i);
  assert.match(sql, /workspace_id, actor_id, action, entity_type, entity_id, metadata, outcome/i);
  assert.match(sql, /auth\.uid\(\)/i);
});

test("CRM audit metadata captures stage and owner transitions without copying contact PII", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /crm\.lead_reassigned/i);
  assert.match(sql, /crm\.lead_stage_changed/i);
  assert.match(sql, /previous_stage/i);
  assert.match(sql, /previous_owner_id/i);
  assert.doesNotMatch(sql, /new\.email|new\.phone|new\.name/i);
});
