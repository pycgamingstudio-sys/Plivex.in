import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 32 * 1024;
const RESOURCES = new Set(["warehouses","warehouse_stock_levels","inventory_batches","warehouse_stock_movements","stock_transfers","purchase_orders","purchase_order_items","crm_leads","crm_activities","suppliers","sales_orders","delivery_challans","credit_debit_notes"]);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value + "T00:00:00.000Z").toISOString().slice(0,10) === value;
function validateMutation(operation: string, values: Record<string, unknown>): string | null {
  if (operation === "create_warehouse") {
    if (typeof values.code !== "string" || !values.code.trim() || values.code.length > 32
      || typeof values.name !== "string" || !values.name.trim() || values.name.length > 160
      || (values.address !== undefined && !object(values.address))
      || (values.is_default !== undefined && typeof values.is_default !== "boolean")) return "Warehouse details are invalid.";
  } else if (operation === "create_lead") {
    if (typeof values.name !== "string" || !values.name.trim() || values.name.length > 200) return "Lead name is required.";
    if (values.email !== undefined && values.email !== null && (typeof values.email !== "string" || values.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))) return "Lead email is invalid.";
    if (values.score !== undefined && (!Number.isInteger(values.score) || Number(values.score) < 0 || Number(values.score) > 100)) return "Lead score must be between 0 and 100.";
    if (values.estimated_value_minor !== undefined && (!Number.isSafeInteger(values.estimated_value_minor) || Number(values.estimated_value_minor) < 0)) return "Lead value must be a non-negative integer in minor units.";
    if (values.owner_id !== undefined && values.owner_id !== null && !UUID.test(String(values.owner_id))) return "Lead owner is invalid.";
    if (values.next_follow_up_at !== undefined && values.next_follow_up_at !== null && (typeof values.next_follow_up_at !== "string" || !Number.isFinite(Date.parse(values.next_follow_up_at)))) return "Follow-up date is invalid.";
    if (values.stage !== undefined && !["new","qualified","proposal","negotiation","won","lost"].includes(String(values.stage))) return "Lead stage is invalid.";
  } else if (operation === "update_lead") {
    if (typeof values.lead_id !== "string" || !UUID.test(values.lead_id)
      || (values.stage !== undefined && !["new","qualified","proposal","negotiation","won","lost"].includes(String(values.stage)))
      || (values.score !== undefined && (!Number.isInteger(values.score) || Number(values.score) < 0 || Number(values.score) > 100))
      || (values.next_follow_up_at !== undefined && values.next_follow_up_at !== null && (typeof values.next_follow_up_at !== "string" || !Number.isFinite(Date.parse(values.next_follow_up_at))))) return "Lead update details are invalid.";
  } else if (operation === "add_lead_activity") {
    if (typeof values.lead_id !== "string" || !UUID.test(values.lead_id) || typeof values.body !== "string" || !values.body.trim() || values.body.length > 4000
      || (values.activity_type !== undefined && !["note","call","email","meeting","stage_change","follow_up"].includes(String(values.activity_type)))) return "Lead activity details are invalid.";
  } else if (operation === "create_purchase_order") {
    if (typeof values.supplier_name !== "string" || !values.supplier_name.trim() || values.supplier_name.length > 200
      || !Array.isArray(values.items) || values.items.length < 1 || values.items.length > 200) return "Purchase order details are invalid.";
    if (values.items.some(item => !object(item) || typeof item.product_id !== "string" || !UUID.test(item.product_id)
      || typeof item.quantity_ordered !== "number" || !Number.isFinite(item.quantity_ordered) || item.quantity_ordered <= 0
      || Math.round(item.quantity_ordered * 10000) !== item.quantity_ordered * 10000
      || !Number.isSafeInteger(item.unit_cost_minor) || Number(item.unit_cost_minor) < 0)) return "Purchase order lines are invalid.";
    if (values.order_date !== undefined && !validDate(values.order_date)) return "Order date is invalid.";
    if (values.expected_date !== undefined && values.expected_date !== null && !validDate(values.expected_date)) return "Expected date is invalid.";
  } else if (operation === "create_sales_order") {
    if (typeof values.client_id!=="string"||!UUID.test(values.client_id)
      ||typeof values.idempotency_key!=="string"||!UUID.test(values.idempotency_key)
      ||(values.currency_code!==undefined&&typeof values.currency_code!=="string")
      ||(values.order_date!==undefined&&!validDate(values.order_date))
      ||(values.expected_date!==undefined&&values.expected_date!==null&&!validDate(values.expected_date))
      ||!Array.isArray(values.items)||values.items.length<1||values.items.length>100) return "Sales order details are invalid.";
    if(values.items.some(item=>!object(item)||typeof item.description!=="string"||!item.description.trim()||item.description.length>500
      ||typeof item.quantity!=="number"||!Number.isFinite(item.quantity)||item.quantity<=0||Math.round(item.quantity*10000)!==item.quantity*10000
      ||!Number.isSafeInteger(item.unit_price_minor)||item.unit_price_minor<0
      ||!Number.isSafeInteger(item.discount_minor??0)||(item.discount_minor??0)<0
      ||(item.product_id!==null&&item.product_id!==undefined&&(typeof item.product_id!=="string"||!UUID.test(item.product_id))))) return "Sales order lines are invalid.";
  } else if (operation === "update_sales_order_status") {
    if(typeof values.sales_order_id!=="string"||!UUID.test(values.sales_order_id)||!["confirmed","fulfilled","cancelled"].includes(String(values.status||""))) return "Sales order status update is invalid.";
  } else if (operation === "create_delivery_challan") {
    if(typeof values.idempotency_key!=="string"||!UUID.test(values.idempotency_key)
      ||(values.client_id!==undefined&&values.client_id!==null&&(typeof values.client_id!=="string"||!UUID.test(values.client_id)))
      ||(values.sales_order_id!==undefined&&values.sales_order_id!==null&&(typeof values.sales_order_id!=="string"||!UUID.test(values.sales_order_id)))
      ||(values.challan_date!==undefined&&!validDate(values.challan_date))
      ||!Array.isArray(values.items)||values.items.length<1||values.items.length>100) return "Delivery challan details are invalid.";
    if(values.items.some(item=>!object(item)||typeof item.description!=="string"||!item.description.trim()||item.description.length>500
      ||typeof item.quantity!=="number"||!Number.isFinite(item.quantity)||item.quantity<=0||Math.round(item.quantity*10000)!==item.quantity*10000
      ||(item.product_id!==null&&item.product_id!==undefined&&(typeof item.product_id!=="string"||!UUID.test(item.product_id))))) return "Delivery challan lines are invalid.";
  } else if (operation === "update_delivery_challan_status") {
    if(typeof values.challan_id!=="string"||!UUID.test(values.challan_id)||!["issued","delivered","returned","cancelled"].includes(String(values.status||""))) return "Delivery challan status update is invalid.";
  } else if (operation === "create_credit_debit_note") {
    if(typeof values.invoice_id!=="string"||!UUID.test(values.invoice_id)||!["credit","debit"].includes(String(values.note_type||""))
      ||typeof values.reason!=="string"||!values.reason.trim()||values.reason.length>500
      ||typeof values.idempotency_key!=="string"||!UUID.test(values.idempotency_key)
      ||(values.note_date!==undefined&&!validDate(values.note_date))
      ||!Number.isSafeInteger(values.taxable_minor)||values.taxable_minor<=0
      ||!Number.isSafeInteger(values.tax_minor)||values.tax_minor<0
      ||!Number.isSafeInteger(values.total_minor)||values.total_minor!==values.taxable_minor+values.tax_minor) return "Credit/debit note details are invalid.";
  } else if (operation === "update_credit_debit_note_status") {
    if(typeof values.note_id!=="string"||!UUID.test(values.note_id)||!["issued","void"].includes(String(values.status||""))) return "Credit/debit note status update is invalid.";
  } else if (operation === "receive_purchase_order") {
    if (typeof values.purchase_order_id !== "string" || !UUID.test(values.purchase_order_id)
      || typeof values.warehouse_id !== "string" || !UUID.test(values.warehouse_id)
      || typeof values.idempotency_key !== "string" || !UUID.test(values.idempotency_key)
      || !Array.isArray(values.items) || values.items.length < 1 || values.items.length > 200) return "Purchase receipt details are invalid.";
    if (values.items.some(item => !object(item) || typeof item.purchase_order_item_id !== "string" || !UUID.test(item.purchase_order_item_id)
      || typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0
      || Math.round(item.quantity * 10000) !== item.quantity * 10000
      || (item.batch_number !== undefined && item.batch_number !== null && (typeof item.batch_number !== "string" || item.batch_number.length > 100))
      || (item.expires_on !== undefined && item.expires_on !== null && !validDate(item.expires_on)))) return "Purchase receipt lines are invalid.";
  }
  return null;
}

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

    if (body.action === "mutate") {
      const allowed = new Set(["create_warehouse","create_lead","update_lead","add_lead_activity","create_purchase_order","receive_purchase_order","create_sales_order","update_sales_order_status","create_delivery_challan","update_delivery_challan_status","create_credit_debit_note","update_credit_debit_note_status"]);
      if (typeof body.operation !== "string" || !allowed.has(body.operation) || !object(body.values)) {
        return globalJson({ error: "Unsupported Part 4 operation or invalid values." }, 400, origin);
      }
      const validationError = validateMutation(body.operation, body.values);
      if (validationError) return globalJson({ error: validationError }, 400, origin);
      const { data, error } = await auth.admin.rpc("global_part4_mutate", {
        p_user_id: auth.user.id, p_workspace_id: body.workspace_id,
        p_action: body.operation, p_values: body.values,
      });
      if (error) {
        console.error("Global Part 4 mutation RPC failed", { code: error.code });
        return globalJson({ error: "Part 4 operation service is not ready." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const status = reason === "access_denied" || reason === "forbidden" ? 403
          : reason === "purchase_order_not_found" || reason === "warehouse_not_found" || reason === "lead_not_found" || reason === "client_not_found" || reason === "invoice_not_found" || reason === "sales_order_not_found" || reason === "delivery_challan_not_found" || reason === "credit_debit_note_not_found" ? 404
          : reason === "idempotency_conflict" || reason === "receipt_quantity_exceeded" ? 409 : 400;
        const messages: Record<string,string> = {
          access_denied: "You do not have access to this workspace.",
          forbidden: "Your workspace role cannot perform this operation.",
          invalid_currency: "Purchase order currency must match the workspace currency.",
          purchase_order_not_found: "Purchase order not found.",
          warehouse_not_found: "Choose an active warehouse.",
          lead_not_found: "Lead not found.",
          invalid_lead: "Lead update details are invalid.",
          receipt_quantity_exceeded: "Received quantity cannot exceed the outstanding purchase quantity.",
          invalid_lead: "Lead name is required and must be 200 characters or fewer.",
          invalid_warehouse: "Warehouse code and name are required.",
          invalid_sales_order: "Sales order details are invalid.",
          invalid_sales_order_item: "A sales order line has invalid quantity, price or discount.",
          invalid_delivery_challan_item: "A delivery challan line has an invalid quantity or description.",
          invalid_delivery_challan: "Delivery challan details are invalid.",
          invalid_credit_debit_note: "Credit/debit note details are invalid.",
          invalid_note_amount: "The note taxable value, tax and total do not match.",
          credit_note_exceeds_invoice: "Total credit notes cannot exceed the source invoice amount.",
        };
        return globalJson({ error: messages[reason] || "Part 4 operation could not be completed.", reason }, status, origin);
      }
      return globalJson(data, 200, origin);
    }

    return globalJson({ error: "Unsupported Part 4 action." }, 400, origin);
  } catch (error) {
    console.error("global-part4 failed", error);
    return globalJson({ error: "Part 4 request could not be completed." }, 500, origin);
  }
});
