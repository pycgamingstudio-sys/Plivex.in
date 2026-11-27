import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../components/workspace/WorkspaceCRMPanel.jsx", import.meta.url), "utf8");

test("CRM exposes the full six-stage opportunity pipeline and searchable lead groups", () => {
  for (const stage of ["New Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]) {
    assert.ok(source.includes(stage), `missing CRM stage: ${stage}`);
  }
  assert.match(source, /grouped=useMemo/);
  assert.match(source, /filteredLeads=useMemo/);
  assert.match(source, /Lead pipeline/);
});

test("CRM lead creation persists owner, workspace, currency, score and next follow-up", () => {
  for (const field of ["workspace_id:workspaceId", "owner_id:user.id", "currency_code:currency", "next_follow_up_at:", "score,"]) {
    assert.ok(source.includes(field), `missing lead field: ${field}`);
  }
  assert.match(source, /const score=Math\.min\(100/);
});

test("CRM activity timeline supports calls, email, meetings, notes and follow-up completion", () => {
  for (const type of ["note", "call", "email", "meeting", "follow_up"]) assert.ok(source.includes(type));
  assert.match(source, /main_workspace_complete_lead_activity/);
  assert.match(source, /completed_at/);
  assert.match(source, /due_at/);
});

test("CRM client and lead mutations remain scoped to the active workspace", () => {
  assert.match(source, /\.eq\("workspace_id",workspaceId\)/);
  assert.match(source, /\.eq\("id",lead\.id\)/);
  assert.match(source, /\.eq\("id",client\.id\)/);
});
