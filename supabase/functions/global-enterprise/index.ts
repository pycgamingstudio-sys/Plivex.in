import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPROVER_ROLES = new Set(["owner", "admin", "manager", "employee", "accountant"]);
const ESCALATION_ROLES = new Set(["owner", "admin", "manager", "accountant"]);
const DELEGATABLE_PERMISSIONS = new Set(["approval.request","approval.decide","approval.read","audit.read","export.request","fx.convert","branch.read","invoice.read","invoice.create"]);
const ALLOWED_ACTIONS = new Set([
  "branch.create", "branch.archive", "branch.list", "health.read", "fx.snapshot.create", "fx.convert", "permission.set", "approval.request", "approval.list",
  "approval.decide", "approval.cancel", "approval.policy.set", "approval.policy.list", "permission.delegation.create", "permission.delegation.list", "permission.delegation.revoke", "audit.list", "export.request", "retention.set",
]);
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);
  const auth = await authenticateGlobal(req);
  if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);

  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 32768) return globalJson({ error: "Request too large" }, 413, origin);
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || !UUID.test(body.workspaceId || "") || !ALLOWED_ACTIONS.has(body.action)) {
      return globalJson({ error: "Invalid request" }, 400, origin);
    }
    if (body.action === "approval.policy.set") {
      if (!["expense.create", "expense.update", "invoice.issue", "invoice.payment.record"].includes(body.actionType)
        || typeof body.enabled !== "boolean"
        || !Number.isSafeInteger(body.minimumAmountMinor) || body.minimumAmountMinor < 0
        || !Array.isArray(body.approvalLevels) || body.approvalLevels.length < 1 || body.approvalLevels.length > 5
        || body.approvalLevels.some((role: unknown) => typeof role !== "string" || !APPROVER_ROLES.has(role))
        || !Number.isSafeInteger(body.escalationAfterHours) || body.escalationAfterHours < 1 || body.escalationAfterHours > 720
        || typeof body.escalationRole !== "string" || !ESCALATION_ROLES.has(body.escalationRole)
        || body.preventSelfApproval !== true) {
        return globalJson({ error: "Invalid approval policy." }, 400, origin);
      }
    }
    if (body.action === "permission.delegation.create") {
      const expires = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
      if (!UUID.test(body.delegateMemberId || "") || !Array.isArray(body.permissionKeys)
        || body.permissionKeys.length < 1 || body.permissionKeys.length > 9
        || body.permissionKeys.some((key: unknown) => typeof key !== "string" || !DELEGATABLE_PERMISSIONS.has(key))
        || new Set(body.permissionKeys).size !== body.permissionKeys.length
        || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 90 * 24 * 60 * 60 * 1000) {
        return globalJson({ error: "Invalid permission delegation." }, 400, origin);
      }
    }
    if (body.action === "permission.delegation.revoke" && !UUID.test(body.delegationId || "")) {
      return globalJson({ error: "Invalid permission delegation." }, 400, origin);
    }
    const { data: limited, error: limitError } = await auth.admin.rpc("global_consume_enterprise_rate_limit", {
      p_key: auth.user.id, p_limit: 60, p_window_seconds: 60,
    });
    if (limitError) return globalJson({ error: "Rate limiter unavailable" }, 503, origin);
    if (limited !== true) return globalJson({ error: "Rate limit exceeded" }, 429, origin);

    if (body.action === "approval.cancel" && !UUID.test(body.requestId || "")) return globalJson({ error: "Invalid approval request." }, 400, origin);
    if (body.action === "approval.decide" && (!UUID.test(body.requestId || "") || !["approve", "approved", "reject", "rejected"].includes(body.decision))) return globalJson({ error: "Invalid approval decision." }, 400, origin);
    let rpcName = "global_enterprise_action";
    let rpcArgs: Record<string, unknown> = {
      p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_action: body.action, p_payload: body,
    };
    if (body.action === "permission.delegation.create") {
      rpcName = "global_permission_delegation_create";
      rpcArgs = {
        p_user_id: auth.user.id, p_workspace_id: body.workspaceId,
        p_delegate_member_id: body.delegateMemberId, p_permission_keys: body.permissionKeys,
        p_expires_at: new Date(body.expiresAt).toISOString(),
      };
    } else if (body.action === "permission.delegation.list") {
      rpcName = "global_permission_delegation_list";
      rpcArgs = { p_user_id: auth.user.id, p_workspace_id: body.workspaceId };
    } else if (body.action === "permission.delegation.revoke") {
      rpcName = "global_permission_delegation_revoke";
      rpcArgs = { p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_delegation_id: body.delegationId };
    } else if (body.action === "approval.cancel") {
      rpcName = "global_approval_cancel_v2";
      rpcArgs = { p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_request_id: body.requestId };
    } else if (body.action === "approval.request" || body.action === "approval.decide") {
      rpcName = body.action === "approval.request" ? "global_approval_request_v2" : "global_approval_decide_v2";
      rpcArgs = { p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_payload: body };
    } else if (body.action === "approval.list" || body.action === "approval.policy.list") {
      rpcName = body.action === "approval.list" ? "global_approval_list_v2" : "global_list_approval_policies_v2";
      rpcArgs = { p_user_id: auth.user.id, p_workspace_id: body.workspaceId };
    } else if (body.action === "approval.policy.set") {
      rpcName = "global_set_approval_policy_v2";
      rpcArgs = {
        p_user_id: auth.user.id, p_workspace_id: body.workspaceId,
        p_action_type: body.actionType, p_enabled: body.enabled,
        p_minimum_amount_minor: body.minimumAmountMinor, p_approval_levels: body.approvalLevels,
        p_escalation_after_hours: body.escalationAfterHours, p_escalation_role: body.escalationRole,
        p_prevent_self_approval: body.preventSelfApproval,
      };
    }
    const { data, error } = await auth.admin.rpc(rpcName, rpcArgs);
    if (error || !data) return globalJson({ error: "Enterprise operation failed" }, 503, origin);
    if (data.ok !== true) {
      const status = data.code === "ACCESS_DENIED" || data.code === "ADMIN_REQUIRED" || data.code === "PERMISSION_DENIED" || data.code === "APPROVER_ROLE_REQUIRED" || data.code === "SELF_APPROVAL_BLOCKED" ? 403
        : data.code === "BRANCH_NOT_FOUND" || data.code === "MEMBER_NOT_FOUND" || data.code === "REQUEST_NOT_FOUND" || data.code === "DELEGATION_NOT_FOUND" ? 404
        : data.code === "REQUEST_NOT_DECIDABLE" || data.code === "REQUEST_NOT_CANCELLABLE" || data.code === "PERMISSION_ALREADY_OVERRIDDEN" ? 409 : 400;
      return globalJson({ error: data.code }, status, origin);
    }
    const status = body.action === "export.request" || body.action === "approval.request" ? 202
      : body.action === "branch.create" || body.action === "permission.set" || body.action === "approval.policy.set" || body.action === "permission.delegation.create" ? 201 : 200;
    return globalJson(data, status, origin);
  } catch {
    return globalJson({ error: "Enterprise operation failed" }, 500, origin);
  }
});
