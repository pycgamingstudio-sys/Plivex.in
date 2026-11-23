import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const errorStatus = (code: string) => {
  if (["ACCESS_DENIED", "PERMISSION_DENIED", "ADMIN_REQUIRED"].includes(code)) return 403;
  if (["DOCUMENT_NOT_FOUND", "SIGNATURE_LINK_UNAVAILABLE", "DELEGATION_NOT_FOUND"].includes(code)) return 404;
  if (["DOCUMENT_NOT_SIGNABLE", "SIGNATURE_REQUEST_NOT_REVOCABLE"].includes(code)) return 409;
  return 400;
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);

  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 32768) return globalJson({ error: "Request too large" }, 413, origin);
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return globalJson({ error: "Invalid request" }, 400, origin);
    }

    if (body.action === "read" || body.action === "sign") {
      if (typeof body.token !== "string" || !TOKEN.test(body.token)) return globalJson({ error: "Invalid or expired signing link." }, 400, origin);
      const tokenHash = await sha256(body.token);
      if (body.action === "read") {
        const { data, error } = await (await authenticateGlobal(new Request(req.url, { method: "POST", headers: req.headers, body: raw }))).admin.rpc("global_document_signature_read", { p_token_hash: tokenHash });
        if (error) return globalJson({ error: "Could not load the signing request." }, 500, origin);
        if (!data?.ok) return globalJson({ error: data?.code || "SIGNATURE_LINK_UNAVAILABLE" }, errorStatus(data?.code || ""), origin);
        return globalJson(data, 200, origin);
      }
      if (typeof body.signedName !== "string" || body.signedName.trim().length < 1 || body.signedName.trim().length > 160 || body.consent !== true) {
        return globalJson({ error: "Enter the invited signer name and confirm the consent statement." }, 400, origin);
      }
      const auth = await authenticateGlobal(req);
      if ("error" in auth) {
        // Public signing links are bearer-token requests; the service-role client is created by the shared helper.
        return globalJson({ error: "Signing service unavailable." }, 503, origin);
      }
      const { data, error } = await auth.admin.rpc("global_document_signature_sign", {
        p_token_hash: tokenHash, p_signed_name: body.signedName.trim(), p_consent: true,
      });
      if (error) return globalJson({ error: "Could not record the signature." }, 500, origin);
      if (!data?.ok) return globalJson({ error: data?.code || "INVALID_SIGNATURE" }, errorStatus(data?.code || ""), origin);
      return globalJson(data, 200, origin);
    }

    const auth = await authenticateGlobal(req);
    if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);
    if (!UUID.test(body.workspaceId || "")) return globalJson({ error: "Invalid workspace." }, 400, origin);

    if (body.action === "create") {
      if (!["invoice", "quotation"].includes(body.documentType) || !UUID.test(body.documentId || "")
        || typeof body.signerName !== "string" || body.signerName.trim().length < 1 || body.signerName.trim().length > 160
        || typeof body.signerEmail !== "string" || body.signerEmail.length > 254
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.signerEmail)
        || typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.expiresAt))
        || Date.parse(body.expiresAt) <= Date.now() || Date.parse(body.expiresAt) > Date.now() + 7 * 24 * 60 * 60 * 1000) {
        return globalJson({ error: "Invalid signature request." }, 400, origin);
      }
      const token = randomToken();
      const tokenHash = await sha256(token);
      const { data, error } = await auth.admin.rpc("global_document_signature_create", {
        p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_document_type: body.documentType,
        p_document_id: body.documentId, p_signer_name: body.signerName.trim(),
        p_signer_email: body.signerEmail.trim().toLowerCase(), p_token_hash: tokenHash,
        p_expires_at: new Date(body.expiresAt).toISOString(),
      });
      if (error) return globalJson({ error: "Could not create the signature request." }, 500, origin);
      if (!data?.ok) return globalJson({ error: data?.code || "INVALID_SIGNATURE_REQUEST" }, errorStatus(data?.code || ""), origin);
      return globalJson({ ...data, signingPath: "/sign?token=" + token }, 201, origin);
    }

    if (body.action === "list") {
      const { data, error } = await auth.admin.rpc("global_document_signature_list", {
        p_user_id: auth.user.id, p_workspace_id: body.workspaceId,
      });
      if (error) return globalJson({ error: "Could not load signature requests." }, 500, origin);
      if (!data?.ok) return globalJson({ error: data?.code || "ACCESS_DENIED" }, errorStatus(data?.code || ""), origin);
      return globalJson(data, 200, origin);
    }

    if (body.action === "revoke") {
      if (!UUID.test(body.requestId || "")) return globalJson({ error: "Invalid signature request." }, 400, origin);
      const { data, error } = await auth.admin.rpc("global_document_signature_revoke", {
        p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_request_id: body.requestId,
      });
      if (error) return globalJson({ error: "Could not revoke the signature request." }, 500, origin);
      if (!data?.ok) return globalJson({ error: data?.code || "SIGNATURE_REQUEST_NOT_REVOCABLE" }, errorStatus(data?.code || ""), origin);
      return globalJson(data, 200, origin);
    }

    return globalJson({ error: "Unsupported action." }, 400, origin);
  } catch {
    return globalJson({ error: "Invalid request." }, 400, origin);
  }
});
