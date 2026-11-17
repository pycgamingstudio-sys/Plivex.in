import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);

  const auth = await authenticateGlobal(req);
  if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);

  try {
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > 64 * 1024) return globalJson({ error: "Request is too large." }, 413, origin);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 64 * 1024) return globalJson({ error: "Request is too large." }, 413, origin);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return globalJson({ error: "Invalid JSON request." }, 400, origin); }
    if (!isObject(body) || !["list", "create", "status", "convert"].includes(String(body.action))) {
      return globalJson({ error: "Unsupported quotation request." }, 400, origin);
    }

    const action = String(body.action);
    if (action === "create") {
      if (typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)
        || typeof body.currency_code !== "string" || !/^[A-Z]{3}$/.test(body.currency_code)
        || !validDate(body.issue_date)
        || (body.valid_until !== null && body.valid_until !== undefined && !validDate(body.valid_until))
        || (body.client_id !== null && body.client_id !== undefined && (typeof body.client_id !== "string" || !UUID.test(body.client_id)))
        || (body.notes !== null && body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 4000))
        || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
        return globalJson({ error: "Quotation details are invalid. Check the customer, dates and line items." }, 400, origin);
      }
      for (const [index, item] of body.items.entries()) {
        if (!isObject(item) || typeof item.description !== "string" || !item.description.trim() || item.description.length > 500
          || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || Number(item.quantity) > 1_000_000
          || Math.round(Number(item.quantity) * 10000) !== Number(item.quantity) * 10000
          || typeof item.unit_price_minor !== "number" || !Number.isSafeInteger(item.unit_price_minor) || item.unit_price_minor < 0
          || (item.discount_minor !== undefined && (!Number.isSafeInteger(item.discount_minor) || Number(item.discount_minor) < 0))) {
          return globalJson({ error: `Quotation line ${index + 1} has invalid values.` }, 400, origin);
        }
      }
    }
    if (["status", "convert"].includes(action) && (typeof body.quotation_id !== "string" || !UUID.test(body.quotation_id))) {
      return globalJson({ error: "A valid quotation is required." }, 400, origin);
    }
    if (action === "status" && !["sent", "accepted", "rejected", "expired"].includes(String(body.status))) {
      return globalJson({ error: "Choose a valid quotation status." }, 400, origin);
    }

    const { data, error } = await auth.admin.rpc("global_manage_quotation", {
      p_user_id: auth.user.id,
      p_workspace_id: auth.user.workspace_id,
      p_action: action,
      p_quotation_id: body.quotation_id || null,
      p_client_id: body.client_id || null,
      p_currency_code: body.currency_code || null,
      p_issue_date: body.issue_date || null,
      p_valid_until: body.valid_until || null,
      p_notes: body.notes || null,
      p_items: Array.isArray(body.items) ? body.items : [],
      p_status: body.status || null,
      p_idempotency_key: body.idempotency_key || null,
    });
    if (error) {
      console.error("Global quotation RPC failed", { code: error.code });
      return globalJson({ error: "Quotation service is temporarily unavailable. Please try again later." }, 503, origin);
    }
    if (!data?.ok) {
      const reason = String(data?.reason || "request_failed");
      const messages: Record<string, string> = {
        access_denied: "You do not have access to this Global workspace.",
        forbidden: "Your workspace role cannot perform this quotation action.",
        invalid_currency: "Quotation currency must match your workspace currency.",
        client_not_found: "The selected customer is not active in this workspace.",
        quotation_not_found: "Quotation not found.",
        quotation_closed: "This quotation is already closed.",
        invalid_transition: "That status change is not allowed.",
        quotation_not_accepted: "Mark the quotation as accepted before converting it.",
        invoice_conversion_failed: "The invoice draft could not be created. The quotation remains unchanged.",
        invalid_quotation: "Quotation details or dates are invalid.",
        invalid_item_values: "A quotation line has invalid values.",
        invalid_item_discount: "A line discount cannot exceed its line amount.",
        quotation_total_limit: "The quotation total exceeds the supported limit.",
      };
      const status = ["access_denied", "forbidden"].includes(reason) ? 403
        : reason === "quotation_not_found" ? 404
        : ["quotation_closed", "invalid_transition", "quotation_not_accepted"].includes(reason) ? 409 : 400;
      return globalJson({ error: messages[reason] || "Could not complete the quotation request.", reason }, status, origin);
    }
    return globalJson(data, action === "create" ? 201 : 200, origin);
  } catch (error) {
    console.error("global-quotations failed", error);
    return globalJson({ error: "Something went wrong with the Global quotation request." }, 500, origin);
  }
});
