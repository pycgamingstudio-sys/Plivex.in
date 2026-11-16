import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set([
  "branch.create", "branch.archive", "permission.set", "approval.request",
  "approval.decide", "audit.list", "export.request", "retention.set",
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
    const { data: limited, error: limitError } = await auth.admin.rpc("global_consume_enterprise_rate_limit", {
      p_key: auth.user.id, p_limit: 60, p_window_seconds: 60,
    });
    if (limitError) return globalJson({ error: "Rate limiter unavailable" }, 503, origin);
    if (limited !== true) return globalJson({ error: "Rate limit exceeded" }, 429, origin);

    const { data, error } = await auth.admin.rpc("global_enterprise_action", {
      p_user_id: auth.user.id, p_workspace_id: body.workspaceId,
      p_action: body.action, p_payload: body,
    });
    if (error || !data) return globalJson({ error: "Enterprise operation failed" }, 503, origin);
    if (data.ok !== true) {
      const status = data.code === "ACCESS_DENIED" || data.code === "ADMIN_REQUIRED" || data.code === "PERMISSION_DENIED" ? 403
        : data.code === "BRANCH_NOT_FOUND" || data.code === "MEMBER_NOT_FOUND" ? 404
        : data.code === "REQUEST_NOT_DECIDABLE" ? 409 : 400;
      return globalJson({ error: data.code }, status, origin);
    }
    const status = body.action === "export.request" || body.action === "approval.request" ? 202
      : body.action === "branch.create" || body.action === "permission.set" ? 201 : 200;
    return globalJson(data, status, origin);
  } catch {
    return globalJson({ error: "Enterprise operation failed" }, 500, origin);
  }
});
