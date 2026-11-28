const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED = new Map([
  ["expense.update", "expense"],
  ["invoice.issue", "invoice"],
  ["invoice.payment.record", "invoice"],
]);

export function validateGlobalApprovalRequestAction(action) {
  if (!action || typeof action !== "object" || action.type !== "request_global_approval") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const actionType = String(raw.action_type ?? "").trim();
  const resourceType = String(raw.resource_type ?? "").trim();
  const resourceId = String(raw.resource_id ?? "").trim();
  const branchId = raw.branch_id ? String(raw.branch_id).trim() : null;
  const payload = raw.details && typeof raw.details === "object" && !Array.isArray(raw.details) ? raw.details : null;
  if (!ALLOWED.has(actionType) || ALLOWED.get(actionType) !== resourceType || !UUID_RE.test(resourceId)
    || (branchId && !UUID_RE.test(branchId)) || !payload || JSON.stringify(payload).length > 20000) return null;
  return {
    type: "request_global_approval",
    payload: { action_type: actionType, resource_type: resourceType, resource_id: resourceId, branch_id: branchId, details: payload },
  };
}

export function validateGlobalApprovalRequestAgainstContext(action, context) {
  if (!action || action.type !== "request_global_approval" || !context || context.context_unavailable) {
    return { ok: false, reason: "context_unavailable" };
  }
  const collection = action.payload.resource_type === "invoice" ? context.invoices : context.expenses;
  if (!Array.isArray(collection)) return { ok: false, reason: "context_unavailable" };
  const resource = collection.find((item) => item?.id === action.payload.resource_id);
  if (!resource) return { ok: false, reason: "resource_not_found" };
  const status = String(resource.status || "").toLowerCase();
  if (action.payload.action_type === "invoice.issue" && !["draft", "unissued", "pending"].includes(status)) {
    return { ok: false, reason: "resource_state_invalid" };
  }
  return {
    ok: true,
    summary: "Request approval to " + action.payload.action_type.replaceAll(".", " ")
      + " for " + action.payload.resource_type + " " + (resource.invoice_number || resource.expense_number || resource.id)
      + ". The approver will review the attached details; this does not execute the underlying business action.",
  };
}
