import { authenticateGlobal, createGlobalAdminClient, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";
import { escapeEmailHtml, sendEmail, validEmail } from "../_shared/email.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;
const MAX_BODY = 24 * 1024;
const PAYMENT_TERMS = new Set(["due_on_receipt","net_7","net_15","net_30","net_45","net_60","custom"]);
const COUNTRY_CODES = new Set(["IN","US","GB","AE","CA","AU","SG"]);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function validateProfile(profile: unknown): string | null {
  if (!object(profile)) return "Supplier profile is invalid.";
  const required = ["legal_name","contact_name","email"];
  if (required.some((key) => typeof profile[key] !== "string" || !String(profile[key]).trim())) return "Legal name, contact name and email are required.";
  if (String(profile.legal_name).length > 200 || String(profile.contact_name).length > 160 || !validEmail(String(profile.email).trim())) return "Supplier identity details are invalid.";
  if (profile.phone !== undefined && profile.phone !== null && (typeof profile.phone !== "string" || profile.phone.length > 40)) return "Phone number is too long.";
  if (profile.tax_registration_number !== undefined && profile.tax_registration_number !== null && (typeof profile.tax_registration_number !== "string" || profile.tax_registration_number.length > 80)) return "Tax registration number is too long.";
  if (profile.website !== undefined && profile.website !== null && profile.website !== "") {
    if (typeof profile.website !== "string" || profile.website.length > 200) return "Website is invalid.";
    try { if (new URL(profile.website).protocol !== "https:") return "Website must use HTTPS."; } catch { return "Website URL is invalid."; }
  }
  if (profile.business_type !== undefined && profile.business_type !== null && (typeof profile.business_type !== "string" || profile.business_type.length > 100)) return "Business type is too long.";
  if (profile.payment_terms !== undefined && profile.payment_terms !== null && profile.payment_terms !== "" && !PAYMENT_TERMS.has(String(profile.payment_terms))) return "Payment terms are invalid.";
  if (!object(profile.address) || JSON.stringify(profile.address).length > 4000 || !COUNTRY_CODES.has(String(profile.address.country_code || ""))) return "Choose a supported country and enter a valid supplier address.";
  return null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);

  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY) return globalJson({ error: "Request is too large." }, 413, origin);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return globalJson({ error: "Invalid JSON request." }, 400, origin); }
    if (!object(body) || typeof body.action !== "string") return globalJson({ error: "Invalid request body." }, 400, origin);

    if (body.action === "portal.read" || body.action === "portal.submit") {
      if (typeof body.token !== "string" || !TOKEN.test(body.token)) return globalJson({ error: "This supplier invitation link is invalid or expired." }, 400, origin);
      const admin = createGlobalAdminClient();
      const tokenHash = await hashToken(body.token);
      if (body.action === "portal.read") {
        const { data, error } = await admin.rpc("global_supplier_portal_read", { p_token_hash: tokenHash });
        if (error || !data?.ok) return globalJson({ error: "This supplier invitation link is invalid, expired or already used." }, 404, origin);
        return globalJson({ supplier: data.supplier }, 200, origin);
      }
      const validationError = validateProfile(body.profile);
      if (validationError) return globalJson({ error: validationError }, 400, origin);
      const { data, error } = await admin.rpc("global_supplier_portal_submit", { p_token_hash: tokenHash, p_profile: body.profile });
      if (error) {
        console.error("Supplier portal submission failed", { code: error.code });
        return globalJson({ error: "Supplier profile could not be submitted. Please retry or contact the business that invited you." }, 503, origin);
      }
      if (!data?.ok) return globalJson({ error: data?.reason === "invalid_or_expired" ? "This invitation link has expired or has already been used." : "Supplier profile details are invalid." }, 400, origin);
      return globalJson({ ok: true }, 200, origin);
    }

    if (!["invite","list","decide"].includes(body.action)) return globalJson({ error: "Unsupported supplier portal action." }, 400, origin);
    const auth = await authenticateGlobal(req);
    if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);
    if (typeof body.workspace_id !== "string" || !UUID.test(body.workspace_id)) return globalJson({ error: "A valid workspace is required." }, 400, origin);

    if (body.action === "list") {
      const { data, error } = await auth.admin.rpc("global_supplier_portal_list", {
        p_user_id: auth.user.id, p_workspace_id: body.workspace_id, p_limit: 200,
      });
      if (error || !data?.ok) return globalJson({ error: data?.reason === "forbidden" ? "Your role cannot manage supplier onboarding." : "Supplier onboarding records could not be loaded." }, data?.reason === "forbidden" ? 403 : 400, origin);
      return globalJson({ records: data.records || [] }, 200, origin);
    }

    if (body.action === "decide") {
      if (typeof body.supplier_id !== "string" || !UUID.test(body.supplier_id)
        || !["approved","rejected"].includes(String(body.decision || ""))
        || (body.review_note !== undefined && body.review_note !== null && (typeof body.review_note !== "string" || body.review_note.length > 1000))) {
        return globalJson({ error: "Review decision details are invalid." }, 400, origin);
      }
      const { data, error } = await auth.admin.rpc("global_supplier_portal_decide", {
        p_user_id: auth.user.id, p_workspace_id: body.workspace_id, p_supplier_id: body.supplier_id,
        p_decision: body.decision, p_note: body.review_note ?? null,
      });
      if (error || !data?.ok) return globalJson({ error: data?.reason === "forbidden" ? "Your role cannot review suppliers." : "Supplier review could not be saved." }, data?.reason === "forbidden" ? 403 : 400, origin);
      return globalJson(data, 200, origin);
    }

    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200
      || typeof body.email !== "string" || !validEmail(body.email.trim())
      || (body.supplier_id !== undefined && body.supplier_id !== null && (typeof body.supplier_id !== "string" || !UUID.test(body.supplier_id)))
      || (body.phone !== undefined && body.phone !== null && (typeof body.phone !== "string" || body.phone.length > 40))
      || (body.tax_registration_number !== undefined && body.tax_registration_number !== null && (typeof body.tax_registration_number !== "string" || body.tax_registration_number.length > 80))) {
      return globalJson({ error: "Supplier name and a valid email are required." }, 400, origin);
    }
    const token = randomToken();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await auth.admin.rpc("global_supplier_portal_invite", {
      p_user_id: auth.user.id, p_workspace_id: body.workspace_id,
      p_supplier_id: body.supplier_id ?? null, p_name: body.name.trim(),
      p_email: body.email.trim().toLowerCase(), p_phone: body.phone ?? null,
      p_tax_registration_number: body.tax_registration_number ?? null,
      p_token_hash: tokenHash, p_expires_at: expiresAt,
    });
    if (error || !data?.ok) {
      const status = data?.reason === "forbidden" ? 403 : data?.reason === "supplier_not_found" ? 404 : 400;
      return globalJson({ error: data?.reason === "forbidden" ? "Your role cannot invite suppliers." : "Supplier invitation could not be created." }, status, origin);
    }
    const inviteUrl = "https://plivex.in/supplier-portal?token=" + encodeURIComponent(token);
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2>Complete your supplier profile</h2><p>${escapeEmailHtml(body.name.trim())} has been invited to complete supplier onboarding in Plivex.</p><p><a href="${inviteUrl}" style="display:inline-block;background:#6d28d9;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Open supplier portal</a></p><p>This one-time invitation expires in 7 days. If you were not expecting it, you can ignore this email.</p></div>`;
    const mail = await sendEmail({ to: body.email.trim().toLowerCase(), subject: "Complete supplier onboarding", html });
    return globalJson({ ok: true, supplier_id: data.supplier_id, invite_url: inviteUrl, email_sent: mail.sent, email_reason: mail.sent ? null : mail.reason }, 200, origin);
  } catch (error) {
    console.error("global-supplier-portal failed", error instanceof Error ? error.message : "unknown error");
    return globalJson({ error: "Supplier portal request could not be completed." }, 500, origin);
  }
});
