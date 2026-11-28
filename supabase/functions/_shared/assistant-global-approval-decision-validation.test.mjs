import test from "node:test";
import assert from "node:assert/strict";
import { validateGlobalApprovalDecisionAction, validateGlobalApprovalDecisionAgainstContext } from "./assistant-global-approval-decision-validation.mjs";

const requestId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

test("validates approve/reject decisions and bounds notes", () => {
  assert.deepEqual(validateGlobalApprovalDecisionAction({ type: "decide_global_approval", payload: {
    request_id: requestId, decision: "approve", note: "Reviewed"
  }}), { type: "decide_global_approval", payload: { request_id: requestId, decision: "approved", note: "Reviewed" } });
  assert.equal(validateGlobalApprovalDecisionAction({ type: "decide_global_approval", payload: {
    request_id: "bad", decision: "approve"
  }}), null);
  assert.equal(validateGlobalApprovalDecisionAction({ type: "decide_global_approval", payload: {
    request_id: requestId, decision: "maybe"
  }}), null);
  assert.equal(validateGlobalApprovalDecisionAction({ type: "decide_global_approval", payload: {
    request_id: requestId, decision: "reject", note: "x".repeat(3000)
  }}).payload.note.length, 2000);
});

test("requires an exact pending request and blocks self-approval", () => {
  const action = validateGlobalApprovalDecisionAction({ type: "decide_global_approval", payload: { request_id: requestId, decision: "approve" } });
  const context = { approvals: [{ id: requestId, requester_id: "33333333-3333-4333-8333-333333333333", status: "pending", action_type: "invoice.issue", resource_type: "invoice", resource_id: "INV" }] };
  assert.equal(validateGlobalApprovalDecisionAgainstContext(action, context, userId).ok, true);
  assert.equal(validateGlobalApprovalDecisionAgainstContext(action, { approvals: [{ ...context.approvals[0], requester_id: userId }] }, userId).reason, "self_approval");
  assert.equal(validateGlobalApprovalDecisionAgainstContext(action, { approvals: [] }, userId).reason, "request_not_found");
  assert.equal(validateGlobalApprovalDecisionAgainstContext(action, { context_unavailable: true }, userId).reason, "context_unavailable");
});
