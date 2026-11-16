import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPROVER_ROLES = new Set(["owner", "admin", "manager", "employee", "accountant", "viewer"]);
const ALLOWED_ACTIONS = new Set([
  "branch.create", "branch.archive", "branch.list", "health.read", "fx.snapshot.create", "fx.convert", "permission.set", "approval.request", "approval.list",
  "approval.decide", "approval.cancel", "approval.policy.set", "audit.list", "export.request", "retention.set",
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
      if (!["expense.create", "expense.update"].includes(body.actionType)
        || typeof body.enabled !== "boolean"
        || !Number.isSafeInteger(body.minimumAmountMinor) || body.minimumAmountMinor < 0
        || !Array.isArray(body.approverRoles) || body.approverRoles.length < 1
        || body.approverRoles.length > 6
        || body.approverRoles.some((role: unknown) => typeof role !== "string" || !APPROVER_ROLES.has(role))
        || typeof body.preventSelfApproval !== "boolean") {
        return globalJson({ error: "Invalid approval policy." }, 400, origin);
      }
    }
    const { data: limited, error: limitError } = await auth.admin.rpc("global_consume_enterprise_rate_limit", {
      p_key: auth.user.id, p_limit: 60, p_window_seconds: 60,
    });
    if (limitError) return globalJson({ error: "Rate limiter unavailable" }, 503, origin);
    if (limited !== true) return globalJson({ error: "Rate limit exceeded" }, 429, origin);

    const rpcName = body.action === "approval.cancel" ? "global_cancel_approval_request"
      : body.action === "approval.policy.set" ? "global_set_approval_policy" : "global_enterprise_action";
    const rpcArgs = body.action === "approval.cancel"
      ? { p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_request_id: body.requestId }
      : body.action === "approval.policy.set"
        ? {
          p_user_id: auth.user.id,
          p_workspace_id: body.workspaceId,
          p_action_type: body.actionType,
          p_enabled: body.enabled,
          p_minimum_amount_minor: body.minimumAmountMinor,
          p_approver_roles: body.approverRoles,
          p_prevent_self_approval: body.preventSelfApproval,
        }
        : { p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_action: body.action, p_payload: body };
    const { data, error } = await auth.admin.rpc(rpcName, rpcArgs);
    if (error || !data) return globalJson({ error: "Enterprise operation failed" }, 503, origin);
    if (data.ok !== true) {
      const status = data.code === "ACCESS_DENIED" || data.code === "ADMIN_REQUIRED" || data.code === "PERMISSION_DENIED" ? 403
        : data.code === "BRANCH_NOT_FOUND" || data.code === "MEMBER_NOT_FOUND" ? 404
        : data.code === "REQUEST_NOT_DECIDABLE" || data.code === "REQUEST_NOT_CANCELLABLE" ? 409 : 400;
      return globalJson({ error: data.code }, status, origin);
    }
    const status = body.action === "export.request" || body.action === "approval.request" ? 202
      : body.action === "branch.create" || body.action === "permission.set" || body.action === "approval.policy.set" ? 201 : 200;
    return globalJson(data, status, origin);
  } catch {
    return globalJson({ error: "Enterprise operation failed" }, 500, origin);
  }
});
