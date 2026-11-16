import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 32 * 1024;
const RESOURCES = new Set(["warehouses","warehouse_stock_levels","inventory_batches","stock_transfers","purchase_orders","purchase_order_items","crm_leads","crm_activities"]);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);
  const auth = await authenticateGlobal(req);
  if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);

  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY) return globalJson({ error: "Request is too large." }, 413, origin);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return globalJson({ error: "Invalid JSON request." }, 400, origin); }
    if (!object(body)) return globalJson({ error: "Invalid request body." }, 400, origin);
    if (typeof body.workspace_id !== "string" || !UUID.test(body.workspace_id)) return globalJson({ error: "A valid workspace_id is required." }, 400, origin);

    if (body.action === "list") {
      if (typeof body.resource !== "string" || !RESOURCES.has(body.resource)) return globalJson({ error: "Unsupported Part 4 resource." }, 400, origin);
      const { data, error } = await auth.admin.rpc("global_part4_list", {
        p_user_id: auth.user.id, p_workspace_id: body.workspace_id,
        p_resource: body.resource, p_limit: Number.isInteger(body.limit) ? Math.max(1, Math.min(500, Number(body.limit))) : 100,
      });
      if (error) {
        console.error("Global Part 4 list RPC failed", { code: error.code });
        return globalJson({ error: "Part 4 data service is not ready." }, 503, origin);
      }
      if (!data?.ok) return globalJson({ error: data?.reason === "access_denied" ? "Workspace access denied." : "Could not load Part 4 records.", reason: data?.reason }, data?.reason === "access_denied" ? 403 : 400, origin);
      return globalJson({ records: data.records || [] }, 200, origin);
    }

    if (body.action === "transfer") {
      if (typeof body.from_warehouse_id !== "string" || !UUID.test(body.from_warehouse_id)
        || typeof body.to_warehouse_id !== "string" || !UUID.test(body.to_warehouse_id)
        || typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)
        || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 200) {
        return globalJson({ error: "Transfer details are invalid." }, 400, origin);
      }
      if (body.items.some((item) => !object(item) || typeof item.product_id !== "string" || !UUID.test(item.product_id)
        || typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0
        || Math.round(item.quantity * 10000) !== item.quantity * 10000)) {
        return globalJson({ error: "Each transfer line needs a product and a positive quantity with up to four decimal places." }, 400, origin);
      }
      if (body.notes !== undefined && body.notes !== null && (typeof body.notes !== "string" || body.notes.length > 1000)) return globalJson({ error: "Notes are too long." }, 400, origin);
      const { data, error } = await auth.admin.rpc("global_part4_transfer_stock", {
        p_user_id: auth.user.id, p_workspace_id: body.workspace_id,
        p_from: body.from_warehouse_id, p_to: body.to_warehouse_id,
        p_items: body.items, p_idempotency_key: body.idempotency_key,
        p_notes: body.notes ?? null,
      });
      if (error) {
        console.error("Global Part 4 transfer RPC failed", { code: error.code });
        return globalJson({ error: "Stock transfer service is not ready." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const status = reason === "access_denied" || reason === "forbidden" ? 403
          : reason === "warehouse_not_found" ? 404
          : reason === "insufficient_stock" || reason === "idempotency_conflict" ? 409 : 400;
        const messages: Record<string,string> = {
          access_denied: "You do not have access to this workspace.",
          forbidden: "Your workspace role cannot transfer stock.",
          warehouse_not_found: "One of the selected warehouses is unavailable.",
          insufficient_stock: "There is not enough stock in the source warehouse.",
          idempotency_conflict: "This request ID was already used for a different transfer.",
        };
        return globalJson({ error: messages[reason] || "Stock transfer could not be completed.", reason }, status, origin);
      }
      return globalJson(data, 200, origin);
    }

    return globalJson({ error: "Unsupported Part 4 action." }, 400, origin);
  } catch (error) {
    console.error("global-part4 failed", error);
    return globalJson({ error: "Part 4 request could not be completed." }, 500, origin);
  }
});
