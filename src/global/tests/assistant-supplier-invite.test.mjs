import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSupplierInviteAction as validateChatInvite } from "../../../supabase/functions/assistant-chat/_shared/assistant-supplier-validation.mjs";
import { validateSupplierInviteAction as validateConfirmInvite } from "../../../supabase/functions/assistant-confirm/_shared/assistant-supplier-validation.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const registry = read("../../../supabase/functions/assistant-chat/_shared/assistant-tool-registry.mjs");
const planner = read("../../../supabase/functions/assistant-chat/_shared/assistant-intent-planner.mjs");
const chat = read("../../../supabase/functions/assistant-chat/source/index.ts");
const confirm = read("../../../supabase/functions/assistant-confirm/source/index.ts");

const validAction = { type: "invite_supplier", payload: { supplier_name: "Acme Components", email: "BUYING@ACME.EXAMPLE" } };

test("Nova validates supplier name and normalizes supplier email before confirmation", () => {
  const expected = { type: "invite_supplier", payload: { supplier_name: "Acme Components", email: "buying@acme.example" } };
  assert.deepEqual(validateChatInvite(validAction), expected);
  assert.deepEqual(validateConfirmInvite(validAction), expected);
  assert.equal(validateChatInvite({ ...validAction, payload: { ...validAction.payload, email: "not-an-email" } }), null);
  assert.equal(validateChatInvite({ ...validAction, payload: { ...validAction.payload, supplier_name: "x" } }), null);
});

test("supplier invitation is an allow-listed, confirmed AI business action", () => {
  assert.match(registry, /invite_supplier: \{ module: "suppliers", approval: "user_confirmation"/);
  assert.match(registry, /suppliers: \{ readContext: false, writeTools: \["invite_supplier"\], planned: false \}/);
  assert.match(planner, /type: "invite_supplier"/);
  assert.match(chat, /validateSupplierInviteAction/);
  assert.match(chat, /secure Plivex supplier onboarding form/);
});

test("supplier invite confirmation uses the secure portal, verifies the supplier row and returns the expiring link", () => {
  assert.match(confirm, /functions\.invoke\("workspace-supplier-portal"/);
  assert.match(confirm, /action: "invite\.create"/);
  assert.match(confirm, /supplierRow\?\.status === "invited"/);
  assert.match(confirm, /invitation\.inviteUrl/);
  assert.match(confirm, /invitation\.expiresAt/);
});
