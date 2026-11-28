import test from "node:test";
import assert from "node:assert/strict";
import { validateGlobalApprovalRequestAction, validateGlobalApprovalRequestAgainstContext } from "./assistant-global-approval-validation.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const action = validateGlobalApprovalRequestAction({ type: "request_global_approval", payload: {
  action_type: "invoice.issue", resource_type: "invoice", resource_id: id, details: { note: "Ready to issue" }
}});

test("allows only supported approval action/resource pairs with UUID targets", () => {
  assert.ok(action);
  assert.equal(validateGlobalApprovalRequestAction({ type: "request_global_approval", payload: {
    action_type: "invoice.issue", resource_type: "expense", resource_id: id, details: {}
  }}), null);
  assert.equal(validateGlobalApprovalRequestAction({ type: "request_global_approval", payload: {
    action_type: "invoice.delete", resource_type: "invoice", resource_id: id, details: {}
  }}), null);
});

test("requires the target invoice or expense to exist in live workspace context", () => {
  assert.equal(validateGlobalApprovalRequestAgainstContext(action, { invoices: [{ id, status: "draft", invoice_number: "INV-1" }], expenses: [] }).ok, true);
  assert.equal(validateGlobalApprovalRequestAgainstContext(action, { invoices: [], expenses: [] }).reason, "resource_not_found");
  assert.equal(validateGlobalApprovalRequestAgainstContext(action, { invoices: [{ id, status: "paid" }], expenses: [] }).reason, "resource_state_invalid");
  assert.equal(validateGlobalApprovalRequestAgainstContext(action, { context_unavailable: true }).reason, "context_unavailable");
});
