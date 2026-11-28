const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_PERMISSIONS = new Set([
  "approval.request", "approval.decide", "approval.read", "audit.read",
  "export.request", "fx.convert", "branch.read", "invoice.read", "invoice.create",
]);

export function validateGlobalMemberPermissionAction(action) {
  if (!action || typeof action !== "object" || action.type !== "set_global_member_permission") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const memberId = String(raw.member_id ?? "").trim();
  const permissionKey = String(raw.permission_key ?? "").trim().toLowerCase();
  const effect = String(raw.effect ?? "").trim().toLowerCase();
  if (!UUID_RE.test(memberId) || !ALLOWED_PERMISSIONS.has(permissionKey) || !["grant", "deny"].includes(effect)) return null;
  return {
    type: "set_global_member_permission",
    payload: { member_id: memberId, permission_key: permissionKey, effect },
  };
}

export function validateGlobalMemberPermissionAgainstContext(action, context) {
  if (!action || action.type !== "set_global_member_permission" || !context || context.context_unavailable
    || !Array.isArray(context.members)) return { ok: false, reason: "context_unavailable" };
  const member = context.members.find((item) => item?.id === action.payload.member_id && item?.status === "active");
  if (!member) return { ok: false, reason: "member_not_found" };
  if (["owner", "admin"].includes(String(member.role || ""))) return { ok: false, reason: "admin_override_not_supported" };
  const existing = Array.isArray(member.permission_overrides)
    ? member.permission_overrides.find((item) => item?.permission_key === action.payload.permission_key) : null;
  if (existing?.effect === action.payload.effect) return { ok: false, reason: "already_set" };
  return {
    ok: true,
    summary: (action.payload.effect === "grant" ? "Grant " : "Deny ") + action.payload.permission_key
      + " for " + (member.email || member.role || "the selected team member")
      + ". Main Workspace owner/admin authorization will be rechecked before saving.",
  };
}
