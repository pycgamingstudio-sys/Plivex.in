import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCreateBranchAction as validateChatBranch } from "../../../supabase/functions/assistant-chat/_shared/assistant-branch-validation.mjs";
import { validateCreateBranchAction as validateConfirmBranch } from "../../../supabase/functions/assistant-confirm/_shared/assistant-branch-validation.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const registry = read("../../../supabase/functions/assistant-chat/_shared/assistant-tool-registry.mjs");
const planner = read("../../../supabase/functions/assistant-chat/_shared/assistant-intent-planner.mjs");
const chat = read("../../../supabase/functions/assistant-chat/source/index.ts");
const confirm = read("../../../supabase/functions/assistant-confirm/source/index.ts");

const validAction = { type: "create_branch", payload: { name: "Delhi North", branch_code: "DEL-N", address: { city: "Delhi", country_code: "IN" } } };

test("Nova validates branch names, unique-format codes and safe address fields", () => {
  const expected = { type: "create_branch", payload: { name: "Delhi North", branch_code: "DEL-N", address: { city: "Delhi", country_code: "IN" } } };
  assert.deepEqual(validateChatBranch(validAction), expected);
  assert.deepEqual(validateConfirmBranch(validAction), expected);
  assert.equal(validateChatBranch({ ...validAction, payload: { ...validAction.payload, branch_code: "bad code" } }), null);
  assert.equal(validateChatBranch({ ...validAction, payload: { ...validAction.payload, address: { city: 3 } } }), null);
});

test("branch creation is an allow-listed, user-confirmed Nova action with workspace branch context", () => {
  assert.match(registry, /create_branch: \{ module: "branches", approval: "user_confirmation"/);
  assert.match(registry, /branches: \{ readContext: true, writeTools: \["create_branch"\], planned: false \}/);
  assert.match(planner, /type: "create_branch"/);
  assert.match(chat, /validateCreateBranchAction/);
  assert.match(chat, /type === "create_branch"/);
  assert.doesNotMatch(chat, /workspace_branches/); // Chat only validates/plans; the confirmation endpoint performs the database write.
});

test("branch creation uses the active workspace, current user and RLS-backed global schema", () => {
  assert.match(confirm, /supabase\.schema\("global"\)/);
  assert.match(confirm, /workspace_id: profile\.workspace_id/);
  assert.match(confirm, /created_by: user\.id/);
  assert.match(confirm, /workspace_branches/);
  assert.match(confirm, /verifiedBranch\?\.status === "active"/);
});
