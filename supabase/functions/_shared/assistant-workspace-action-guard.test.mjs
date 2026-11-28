import test from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_ONLY_ASSISTANT_ACTIONS, isGlobalOnlyAssistantAction } from "./assistant-workspace-action-guard.mjs";

test("classifies every Global-only write as Global-only", () => {
  assert.deepEqual([...GLOBAL_ONLY_ASSISTANT_ACTIONS].sort(), [
    "create_global_branch",
    "create_global_client",
    "create_global_expense",
    "create_global_product",
    "create_global_supplier",
    "record_global_invoice_payment",
    "request_global_approval",
    "set_global_member_permission",
    "transfer_global_stock",
  ]);
  for (const type of GLOBAL_ONLY_ASSISTANT_ACTIONS) {
    assert.equal(isGlobalOnlyAssistantAction(type), true, type);
  }
});

test("does not classify India workspace actions as Global-only", () => {
  for (const type of ["create_client", "create_expense", "create_stock", "create_invoice", "create_warehouse"]) {
    assert.equal(isGlobalOnlyAssistantAction(type), false, type);
  }
});

test("rejects unknown and empty action types as non-Global-only without throwing", () => {
  assert.equal(isGlobalOnlyAssistantAction("unknown_action"), false);
  assert.equal(isGlobalOnlyAssistantAction(null), false);
  assert.equal(isGlobalOnlyAssistantAction(undefined), false);
});
