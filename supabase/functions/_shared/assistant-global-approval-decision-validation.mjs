const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateGlobalApprovalDecisionAction(action) {
  if (!action || typeof action !== "object" || action.type !== "decide_global_approval") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const requestId = String(raw.request_id ?? "").trim();
  const decision = String(raw.decision ?? "").trim().toLowerCase();
  const note = String(raw.note ?? "").trim().slice(0, 2000);
  if (!UUID_RE.test(requestId) || !["approve", "approved", "reject", "rejected"].includes(decision)) return null;
  return {
    type: "decide_global_approval",
    payload: { request_id: requestId, decision: decision.startsWith("approv") ? "approved" : "rejected", note },
  };
}

export function validateGlobalApprovalDecisionAgainstContext(action, context, currentUserId) {
  if (!action || action.type !== "decide_global_approval" || !context || context.context_unavailable
    || !Array.isArray(context.approvals)) return { ok: false, reason: "context_unavailable" };
  const request = context.approvals.find((item) => item?.id === action.payload.request_id && item?.status === "pending");
  if (!request) return { ok: false, reason: "request_not_found" };
  if (request.requester_id && request.requester_id === currentUserId) return { ok: false, reason: "self_approval" };
  return {
    ok: true,
    summary: (action.payload.decision === "approved" ? "Approve" : "Reject")
      + " pending " + request.action_type + " request for " + request.resource_type + " " + request.resource_id
      + ". The approval engine will recheck approver permissions, workflow level and self-approval protection.",
  };
}
