import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(["opening", "receipt", "sale", "return", "adjustment"]);
const MAX_BODY_BYTES = 8 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateMovement(body: Record<string, unknown>): string | null {
  if (typeof body.workspace_id !== "string" || !UUID.test(body.workspace_id)) return "A valid workspace_id is required.";
  if (typeof body.product_id !== "string" || !UUID.test(body.product_id)) return "Choose a valid product.";
  if (typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)) return "A valid request id is required.";
  if (typeof body.movement_type !== "string" || !TYPES.has(body.movement_type)) return "Choose a supported stock movement type.";
  if (typeof body.quantity_delta !== "number" || !Number.isFinite(body.quantity_delta)
      || body.quantity_delta === 0 || Math.abs(body.quantity_delta) > 1_000_000_000_000
      || Math.round(body.quantity_delta * 10000) !== body.quantity_delta * 10000) {
    return "Enter a non-zero quantity with no more than four decimal places.";
  }
  if (["opening", "receipt", "return"].includes(String(body.movement_type)) && body.quantity_delta < 0) return "This movement type must increase stock.";
  if (body.movement_type === "sale" && body.quantity_delta > 0) return "A sale must decrease stock.";
  if (body.notes !== undefined && body.notes !== null && (typeof body.notes !== "string" || body.notes.length > 1000)) return "Notes must be 1,000 characters or fewer.";
  return null;
}

function responseStatus(reason: string): number {
  if (reason === "access_denied" || reason === "forbidden") return 403;
  if (reason === "product_not_found") return 404;
  if (reason === "insufficient_stock" || reason === "idempotency_conflict") return 409;
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
    const validationError = validateMovement(body);
    if (validationError) return globalJson({ error: validationError }, 400, origin);

    const { data, error } = await auth.admin.rpc("global_record_stock_movement", {
      p_user_id: auth.user.id,
      p_workspace_id: body.workspace_id,
      p_product_id: body.product_id,
      p_movement_type: body.movement_type,
      p_quantity_delta: body.quantity_delta,
      p_notes: body.notes ?? null,
      p_idempotency_key: body.idempotency_key,
    });
    if (error) {
      console.error("Global stock movement RPC failed", { code: error.code });
      return globalJson({ error: "Inventory service is not ready. Please try again later." }, 503, origin);
    }
    if (!data?.ok) {
      const reason = String(data?.reason || "request_failed");
      const messages: Record<string, string> = {
        invalid_request: "The stock movement request is incomplete.",
        invalid_movement: "The stock movement details are invalid.",
        invalid_notes: "Notes must be 1,000 characters or fewer.",
        access_denied: "You do not have access to this Global workspace.",
        forbidden: "Your workspace role cannot record stock movements.",
        product_not_found: "The selected product is unavailable in this workspace.",
        insufficient_stock: "This movement would make stock negative.",
        idempotency_conflict: "This request id was already used for a different movement.",
      };
      return globalJson({ error: messages[reason] || "Could not record the stock movement.", reason, available: data?.available }, responseStatus(reason), origin);
    }
    return globalJson(data, 200, origin);
  } catch (error) {
    console.error("global-stock-movements failed", error);
    return globalJson({ error: "Something went wrong with the inventory request." }, 500, origin);
  }
});

export { validateMovement };
