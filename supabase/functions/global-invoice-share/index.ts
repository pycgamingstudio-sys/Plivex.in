import { authenticateGlobal, createGlobalAdminClient, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 8 * 1024;
const PUBLIC_URL = "https://plivex.in";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function tokenHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function errorStatus(reason: string): number {
  if (reason === "access_denied" || reason === "forbidden") return 403;
  if (reason === "invoice_not_found" || reason === "share_not_found" || reason === "invalid_or_expired") return 404;
  return 400;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);

  try {
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) return globalJson({ error: "Request is too large." }, 413, origin);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return globalJson({ error: "Request is too large." }, 413, origin);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return globalJson({ error: "Invalid JSON request." }, 400, origin); }
    if (!isObject(body)) return globalJson({ error: "Invalid request body." }, 400, origin);

    // Public resolution is deliberately the only unauthenticated operation.
    if (body.action === "resolve") {
      if (typeof body.token !== "string" || !HASH.test(body.token)) {
        return globalJson({ ok:false, error:"This invoice link is invalid or expired." }, 404, origin);
      }
      const admin = createGlobalAdminClient();
      const clientIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
      if (clientIp) {
        const pepper = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        const keyHash = await hashToken(pepper + ":" + clientIp);
        const { data:rateLimit, error:rateError } = await admin.rpc("global_check_invoice_share_rate_limit", {
          p_key_hash:keyHash, p_limit:60, p_window_seconds:3600,
        });
        if (rateError || rateLimit?.ok !== true) {
          return globalJson({ ok:false, error:"Secure invoice sharing is temporarily unavailable." },503,origin);
        }
        if (rateLimit.allowed !== true) {
          return globalJson({ ok:false, error:"Too many invoice-link requests. Please wait and try again." },429,origin);
        }
      }
      const tokenHash = await hashToken(body.token);
      const { data, error } = await admin.rpc("global_resolve_invoice_share", { p_token_hash:tokenHash });
      if (error || data?.ok !== true || !data?.snapshot) {
        return globalJson({ ok:false, error:"This invoice link has expired, was revoked, or is unavailable." }, 404, origin);
      }
      return globalJson({ ok:true, snapshot:data.snapshot, expires_at:data.expires_at }, 200, origin);
    }

    const auth = await authenticateGlobal(req);
    if ("error" in auth) return globalJson({ error:auth.error }, auth.status, origin);

    if (body.action === "create") {
      if (typeof body.workspace_id !== "string" || !UUID.test(body.workspace_id)
        || typeof body.invoice_id !== "string" || !UUID.test(body.invoice_id)) {
        return globalJson({ error:"A valid workspace and invoice are required." }, 400, origin);
      }
      const days = body.expires_in_days === undefined ? 7 : Number(body.expires_in_days);
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        return globalJson({ error:"Share links may expire between 1 and 30 days." }, 400, origin);
      }
      const token = tokenHex();
      const tokenHash = await hashToken(token);
      const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      const { data, error } = await auth.admin.rpc("global_create_invoice_share", {
        p_user_id:auth.user.id,
        p_workspace_id:body.workspace_id,
        p_invoice_id:body.invoice_id,
        p_token_hash:tokenHash,
        p_expires_at:expiresAt,
      });
      if (error) {
        console.error("Global invoice share creation failed", { code:error.code });
        return globalJson({ error:"Secure invoice sharing is not activated yet. Please try again later." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const messages: Record<string,string> = {
          access_denied:"You do not have access to this Global workspace.",
          forbidden:"Your workspace role cannot share invoices.",
          invoice_not_found:"Invoice not found.",
          invoice_not_shareable:"This invoice cannot be shared.",
          invalid_share_request:"Share-link details are invalid.",
        };
        return globalJson({ error:messages[reason] || "Could not create a secure invoice link.", reason }, errorStatus(reason), origin);
      }
      return globalJson({
        ok:true,
        share_id:data.share_id,
        url:`${PUBLIC_URL}/i/${token}`,
        expires_at:data.expires_at,
      }, 201, origin);
    }

    if (body.action === "revoke") {
      if (typeof body.workspace_id !== "string" || !UUID.test(body.workspace_id)
        || typeof body.share_id !== "string" || !UUID.test(body.share_id)) {
        return globalJson({ error:"A valid share link is required." }, 400, origin);
      }
      const { data, error } = await auth.admin.rpc("global_revoke_invoice_share", {
        p_user_id:auth.user.id,
        p_workspace_id:body.workspace_id,
        p_share_id:body.share_id,
      });
      if (error) {
        console.error("Global invoice share revocation failed", { code:error.code });
        return globalJson({ error:"The invoice link could not be revoked. Please try again." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const messages: Record<string,string> = {
          access_denied:"You do not have access to this Global workspace.",
          forbidden:"Your workspace role cannot revoke invoice links.",
          share_not_found:"This invoice link was not found.",
        };
        return globalJson({ error:messages[reason] || "Could not revoke the invoice link.", reason }, errorStatus(reason), origin);
      }
      return globalJson(data, 200, origin);
    }

    return globalJson({ error:"Unsupported invoice-share action." }, 400, origin);
  } catch (error) {
    console.error("global-invoice-share failed", error);
    return globalJson({ error:"Something went wrong with the secure invoice-share request." }, 500, origin);
  }
});
