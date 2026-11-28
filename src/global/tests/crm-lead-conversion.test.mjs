import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/20261128150000_stage2_crm_lead_conversion.sql", import.meta.url), "utf8");
const panel = await readFile(new URL("../../components/workspace/WorkspaceCRMPanel.jsx", import.meta.url), "utf8");

test("lead conversion is a server-side, workspace-scoped, row-locked operation", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /has_ws_role\(\s*p_workspace_id/);
  assert.match(migration, /where workspace_id = p_workspace_id and id = p_lead_id\s+for update/);
  assert.match(migration, /lower\(coalesce\(v_lead\.stage, ''\)\) = 'lost'/);
});

test("lead conversion creates a client and preserves the original lead and attribution", () => {
  assert.match(migration, /insert into public\.clients/);
  assert.match(migration, /update public\.leads\s+set client_id = v_client_id, stage = 'Won'/);
  assert.match(migration, /crm\.lead_converted/);
  assert.match(migration, /insert into public\.lead_activities/);
  assert.match(migration, /'duplicate', true/);
});

test("CRM exposes explicit conversion and reports already-linked clients", () => {
  assert.match(panel, /main_workspace_convert_lead_to_client/);
  assert.match(panel, /Convert to client/);
  assert.match(panel, /Linked client:/);
  assert.match(panel, /selected\.client_id/);
});
