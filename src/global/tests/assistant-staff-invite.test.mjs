import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateStaffInviteAction as validateChatStaff } from "../../../supabase/functions/assistant-chat/_shared/assistant-staff-validation.mjs";
import { validateStaffInviteAction as validateConfirmStaff } from "../../../supabase/functions/assistant-confirm/_shared/assistant-staff-validation.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const registry = read("../../../supabase/functions/assistant-chat/_shared/assistant-tool-registry.mjs");
const planner = read("../../../supabase/functions/assistant-chat/_shared/assistant-intent-planner.mjs");
const chat = read("../../../supabase/functions/assistant-chat/source/index.ts");
const confirm = read("../../../supabase/functions/assistant-confirm/source/index.ts");

const validAction = { type: "invite_staff", payload: { email: "STAFF@EXAMPLE.COM", name: "Ravi", role: "storekeeper" } };

test("Nova validates staff email and restricts invitations to supported workspace roles", () => {
  const expected = { type: "invite_staff", payload: { email: "staff@example.com", name: "Ravi", role: "storekeeper" } };
  assert.deepEqual(validateChatStaff(validAction), expected);
  assert.deepEqual(validateConfirmStaff(validAction), expected);
  assert.equal(validateChatStaff({ ...validAction, payload: { ...validAction.payload, role: "owner" } }), null);
  assert.equal(validateChatStaff({ ...validAction, payload: { ...validAction.payload, email: "bad" } }), null);
});

test("staff invitation is allow-listed and routed from natural-language intent", () => {
  assert.match(registry, /invite_staff: \{ module: "staff", approval: "user_confirmation"/);
  assert.match(registry, /staff: \{ readContext: false, writeTools: \["invite_staff"\], planned: false \}/);
  assert.match(planner, /type: "invite_staff"/);
  assert.match(chat, /validateStaffInviteAction/);
});

test("staff confirmation uses the existing team invite function and verifies the membership", () => {
  assert.match(confirm, /functions\.invoke\("send-team-invite"/);
  assert.match(confirm, /body: \{ to: payload\.email, role: payload\.role, name: payload\.name \}/);
  assert.match(confirm, /member\?\.status === "invited"/);
  assert.match(confirm, /invitation\.code/);
  assert.match(confirm, /invitation\.emailSent/);
});
