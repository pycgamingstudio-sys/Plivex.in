import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 64 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function statusFor(reason: string): number {
  if (reason === "access_denied" || reason === "forbidden") return 403;
  if (reason === "client_not_found" || reason === "product_not_found" || reason === "invoice_not_found") return 404;
  if (reason === "idempotency_conflict" || reason === "overpayment" || reason === "invoice_not_payable") return 409;
  return 400;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);

  const auth = await authenticateGlobal(req);
  if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);

  try {
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) return globalJson({ error: "Request is too large." }, 413, origin);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return globalJson({ error: "Request is too large." }, 413, origin);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return globalJson({ error: "Invalid JSON request." }, 400, origin); }
    if (!isObject(body)) return globalJson({ error: "Invalid request body." }, 400, origin);

    const workspaceId = body.workspace_id;
    if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) {
      return globalJson({ error: "A valid Global workspace_id is required." }, 400, origin);
    }

    if (body.action === "create_draft") {
      if (body.client_id !== null && body.client_id !== undefined && (typeof body.client_id !== "string" || !UUID.test(body.client_id))) {
        return globalJson({ error: "Choose a valid client." }, 400, origin);
      }
      if (typeof body.currency_code !== "string" || !/^[A-Z]{3}$/.test(body.currency_code)) {
        return globalJson({ error: "A valid workspace currency is required." }, 400, origin);
      }
      if (!validDate(body.issue_date) || (body.due_date !== null && body.due_date !== undefined && !validDate(body.due_date))) {
        return globalJson({ error: "Enter valid invoice and due dates." }, 400, origin);
      }
      if (typeof body.notes === "string" && body.notes.length > 4000) return globalJson({ error: "Notes are too long." }, 400, origin);
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
        return globalJson({ error: "Add between 1 and 100 invoice lines." }, 400, origin);
      }
      const items = [];
      for (const [index, item] of body.items.entries()) {
        if (!isObject(item)) return globalJson({ error: `Invoice line ${index + 1} is invalid.` }, 400, origin);
        const quantity = Number(item.quantity);
        const unitPrice = item.unit_price_minor;
        const discount = item.discount_minor ?? 0;
        if (typeof item.description !== "string" || !item.description.trim() || item.description.length > 500
          || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || Math.round(quantity * 10000) !== quantity * 10000
          || !Number.isSafeInteger(unitPrice) || unitPrice < 0 || unitPrice > 9_000_000_000_000_000
          || !Number.isSafeInteger(discount) || discount < 0 || discount > 9_000_000_000_000_000
          || (item.product_id !== null && item.product_id !== undefined && (typeof item.product_id !== "string" || !UUID.test(item.product_id)))) {
          return globalJson({ error: `Invoice line ${index + 1} has invalid values.` }, 400, origin);
        }
        items.push({
          description: item.description.trim(),
          quantity,
          unit_price_minor: unitPrice,
          discount_minor: discount,
          product_id: item.product_id || null,
        });
      }
      const { data, error } = await auth.admin.rpc("global_create_invoice_draft", {
        p_user_id: auth.user.id,
        p_workspace_id: workspaceId,
        p_client_id: body.client_id || null,
        p_currency_code: body.currency_code,
        p_issue_date: body.issue_date,
        p_due_date: body.due_date || null,
        p_notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
        p_items: items,
      });
      if (error) {
        console.error("Global draft invoice RPC failed", { code: error.code });
        return globalJson({ error: "Draft invoice service is not ready. Please try again later." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const messages: Record<string, string> = {
          access_denied: "You do not have access to this Global workspace.",
          forbidden: "Your workspace role cannot create invoices.",
          invalid_currency: "Invoice currency must match the workspace currency.",
          invalid_dates: "Invoice dates are invalid.",
          invalid_items: "Invoice lines are invalid.",
          invalid_item_values: "An invoice line has invalid values.",
          invalid_item_discount: "A line discount cannot exceed its line amount.",
          invoice_total_limit: "The invoice total exceeds the supported limit.",
          client_not_found: "The selected client is not active in this workspace.",
          product_not_found: "The selected product is not active in this workspace.",
        };
        return globalJson({ error: messages[reason] || "Could not create the draft invoice.", reason }, statusFor(reason), origin);
      }
      return globalJson(data, 201, origin);
    }

    if (body.action === "record_payment") {
      if (typeof body.invoice_id !== "string" || !UUID.test(body.invoice_id)
        || !Number.isSafeInteger(body.amount_minor) || body.amount_minor <= 0
        || typeof body.currency_code !== "string" || !/^[A-Z]{3}$/.test(body.currency_code)
        || !validDate(body.payment_date)
        || typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)) {
        return globalJson({ error: "Payment details are invalid." }, 400, origin);
      }
      for (const [key, limit] of [["method", 80], ["reference", 160], ["notes", 1000]] as const) {
        if (body[key] !== undefined && body[key] !== null && (typeof body[key] !== "string" || body[key].length > limit)) {
          return globalJson({ error: `Invalid ${key} value.` }, 400, origin);
        }
      }
      const { data, error } = await auth.admin.rpc("global_record_invoice_payment", {
        p_user_id: auth.user.id,
        p_workspace_id: workspaceId,
        p_invoice_id: body.invoice_id,
        p_amount_minor: body.amount_minor,
        p_currency_code: body.currency_code,
        p_payment_date: body.payment_date,
        p_method: body.method ?? null,
        p_reference: body.reference ?? null,
        p_notes: body.notes ?? null,
        p_idempotency_key: body.idempotency_key,
      });
      if (error) {
        console.error("Global payment ledger RPC failed", { code: error.code });
        return globalJson({ error: "Payment ledger service is not ready. Please try again later." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const messages: Record<string, string> = {
          access_denied: "You do not have access to this Global workspace.",
          forbidden: "Your workspace role cannot record payments.",
          invoice_not_found: "Invoice not found.",
          invoice_not_payable: "Only issued invoices can receive payment records.",
          invalid_currency: "Payment currency must match the invoice currency.",
          invalid_payment: "Payment details are invalid.",
          overpayment: "Payment exceeds the remaining invoice balance.",
          idempotency_conflict: "This request ID was already used for a different payment.",
        };
        return globalJson({ error: messages[reason] || "Could not record the payment.", reason, remaining_minor: data?.remaining_minor }, statusFor(reason), origin);
      }
      return globalJson(data, 200, origin);
    }

    return globalJson({ error: "Unsupported invoice action." }, 400, origin);
  } catch (error) {
    console.error("global-invoices failed", error);
    return globalJson({ error: "Something went wrong with the Global invoice request." }, 500, origin);
  }
});
