import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateLeadFollowUpAction as validateChatFollowUp } from "../../../supabase/functions/assistant-chat/_shared/assistant-follow-up-validation.mjs";
import { validateLeadFollowUpAction as validateConfirmFollowUp } from "../../../supabase/functions/assistant-confirm/_shared/assistant-follow-up-validation.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const registry = read("../../../supabase/functions/assistant-chat/_shared/assistant-tool-registry.mjs");
const planner = read("../../../supabase/functions/assistant-chat/_shared/assistant-intent-planner.mjs");
const chat = read("../../../supabase/functions/assistant-chat/source/index.ts");
const confirm = read("../../../supabase/functions/assistant-confirm/source/index.ts");

const action = { type: "schedule_lead_follow_up", payload: { lead_id: "11111111-1111-4111-8111-111111111111", due_at: "2026-11-26T10:00:00+05:30", body: "Call about the revised quotation", lead_name: "Sharma Traders" } };
const fixedNow = Date.parse("2026-11-25T00:00:00Z");

test("Nova validates future follow-up dates and normalizes them to UTC", () => {
  const a = validateChatFollowUp(action, fixedNow);
  const b = validateConfirmFollowUp(action, fixedNow);
  assert.deepEqual(a, b);
  assert.equal(a.payload.due_at, "2026-11-26T04:30:00.000Z");
  assert.equal(validateChatFollowUp({ ...action, payload: { ...action.payload, due_at: "2026-11-24T10:00:00Z" } }, fixedNow), null);
  assert.equal(validateChatFollowUp({ ...action, payload: { ...action.payload, lead_id: "bad" } }, fixedNow), null);
});

test("CRM follow-up scheduling is an allow-listed user-confirmed automation action", () => {
  assert.match(registry, /schedule_lead_follow_up: \{ module: "automation", approval: "user_confirmation"/);
  assert.match(registry, /automation: \{ readContext: true, writeTools: \["schedule_lead_follow_up"\], planned: false \}/);
  assert.match(planner, /type: "schedule_lead_follow_up"/);
  assert.match(chat, /validateLeadFollowUpAction/);
});

test("follow-up confirmation scopes the lead and activity to the current workspace and verifies the due date", () => {
  assert.match(confirm, /from\("leads"\)/);
  assert.match(confirm, /from\("lead_activities"\)/);
  assert.match(confirm, /activity_type: "follow_up"/);
  assert.match(confirm, /created_by: user\.id/);
  assert.match(confirm, /verifiedActivity\?\.activity_type === "follow_up"/);
});
