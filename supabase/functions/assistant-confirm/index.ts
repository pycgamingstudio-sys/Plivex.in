import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { validateInvoiceAction } from "../_shared/assistant-invoice-validation.mjs";
import { validateGoodsReceiptAction } from "../_shared/assistant-goods-receipt-validation.mjs";
import { validatePurchaseOrderAction } from "../_shared/assistant-purchase-order-validation.mjs";

const ALLOWED_ORIGINS = new Set([
  "https://plivex.in",
  "https://www.plivex.in",
  "https://plivex.netlify.app",
]);

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://plivex.in";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const number = (value: unknown, fallback = NaN) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const allowedCategories = ["Rent", "Raw Materials", "Utilities", "Salary", "Logistics", "Software", "Marketing", "Other"];

function validateAction(action: unknown) {
  if (!action || typeof action !== "object") return null;
  const candidate = action as Record<string, unknown>;
  const type = text(candidate.type, 40);
  const raw = candidate.payload && typeof candidate.payload === "object" ? candidate.payload as Record<string, unknown> : {};
  if (type === "create_purchase_order") {
    return validatePurchaseOrderAction(action);
  }
  if (type === "receive_purchase_order") {
    return validateGoodsReceiptAction(action);
  }
  if (type === "create_invoice") {
    return validateInvoiceAction(action);
  }
  if (type === "create_expense") {
    const amount = number(raw.amount);
    if (!(amount > 0)) return null;
    return { type, payload: { vendor: text(raw.vendor,120), category: allowedCategories.includes(text(raw.category,40)) ? text(raw.category,40) : "Other", amount, date: text(raw.date,10), status: text(raw.status,40), method: text(raw.method,40), notes: text(raw.notes,500) } };
  }
  if (type === "create_stock") {
    const quantity = number(raw.quantity), price = number(raw.price);
    const name = text(raw.name,120);
    if (!name || !(quantity > 0) || !(price >= 0)) return null;
    return { type, payload: { name, sku: text(raw.sku,80), quantity, unit: text(raw.unit,30) || "pcs", price, low_stock: Math.max(0,number(raw.low_stock,5)) } };
  }
  if (type === "create_client") {
    const name=text(raw.name,120); if(!name) return null;
    return {type,payload:{name,company:text(raw.company,120),email:text(raw.email,180),phone:text(raw.phone,40),gstin:text(raw.gstin,30),address:text(raw.address,400)}};
  }
  if (type === "create_lead") {
    const name=text(raw.name,120); if(!name) return null;
    return {type,payload:{name,phone:text(raw.phone,40),requirement:text(raw.requirement,500),value:Math.max(0,number(raw.value,0)),stage:text(raw.stage,60)||"New"}};
  }
  if (type === "create_quotation") {
    const client_name=text(raw.client_name,120), total=number(raw.total);
    if(!client_name || !(total>=0)) return null;
    return {type,payload:{client_name,total,date:text(raw.date,10),status:raw.status==="sent"?"sent":"draft",tax_rate:Math.max(0,number(raw.tax_rate,0)),items:Array.isArray(raw.items)?raw.items.slice(0,30):[]}};
  }
  return null;
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { "Vary": "Origin", "Content-Type": "application/json" },
    });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in to confirm this action." }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "Assistant confirmation is not configured." }, 503, origin);

  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);

    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("workspace_id,role").eq("id", user.id).maybeSingle();
    if (profileError || !profile?.workspace_id) return json({ error: "Your Plivex workspace could not be found." }, 403, origin);

    const body = await req.json().catch(() => null);
    const rawActions = Array.isArray(body?.actions) ? body.actions : [body?.action];
    if (!rawActions.length || rawActions.length > 10) return json({ error: "Please confirm between 1 and 10 valid actions." }, 400, origin);
    const actions = rawActions.map(validateAction);
    if (actions.some((action: unknown) => !action)) return json({ error: "Some action details are missing or invalid. Nothing was saved." }, 400, origin);
    const idempotencyKey = text(body?.idempotencyKey,160);
    if (idempotencyKey.length < 16) return json({ error: "Confirmation key is missing. Please refresh the pending action and try again." }, 400, origin);
    if (actions.some((action: any) => action.type === "create_purchase_order")) {
      if (actions.length !== 1) return json({ error: "Purchase-order creation must be confirmed separately from other actions." }, 400, origin);
      const payload = actions[0].payload;
      const canonical = JSON.stringify(actions);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      const requestHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: order, error: orderError } = await supabase.rpc("assistant_create_purchase_order_idempotent", {
        p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash,
        p_supplier_name: payload.supplier_name,
        p_items: payload.items,
        p_supplier_reference: payload.supplier_reference || null,
        p_expected_date: payload.expected_date || null,
        p_notes: payload.notes || null,
      });
      if (orderError) {
        console.error("Purchase order creation rejected", { code: orderError.code, userId: user.id });
        const message = String(orderError.message || "");
        if (message.includes("PERMISSION_DENIED")) return json({ error: "Only a workspace admin or manager can create a purchase order." }, 403, origin);
        if (message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) return json({ error: "This confirmation key was already used for different purchase-order details. Prepare the order again." }, 409, origin);
        return json({ error: "The purchase order could not be created. Check supplier, stock items and workspace currency, then try again." }, 400, origin);
      }
      if (!order?.ok || !order?.purchase_order_id) {
        const reason = String(order?.reason || "");
        const message = reason === "forbidden" ? "Only a workspace admin or manager can create a purchase order."
          : reason === "workspace_currency_unconfigured" ? "Set the workspace currency before creating a purchase order."
          : reason === "stock_item_not_found" ? "One of the selected stock items no longer exists in this workspace."
          : "The purchase-order details were rejected. Nothing was saved.";
        return json({ error: message }, reason === "forbidden" ? 403 : 400, origin);
      }
      const [orderCheck, linesCheck] = await Promise.all([
        supabase.from("purchase_orders").select("id").eq("workspace_id", profile.workspace_id).eq("id", order.purchase_order_id).maybeSingle(),
        supabase.from("purchase_order_items").select("id").eq("workspace_id", profile.workspace_id).eq("purchase_order_id", order.purchase_order_id),
      ]);
      const verified = !orderCheck.error && Boolean(orderCheck.data?.id)
        && !linesCheck.error && linesCheck.data?.length === payload.items.length;
      return json({
        ok: true,
        verified,
        reply: verified ? "Purchase order created and verified. It is saved as an order in your Plivex workspace." : "The purchase order was accepted, but Plivex could not verify every line. Check Purchase Orders before retrying.",
        created: [{ type: "create_purchase_order", id: order.purchase_order_id }],
        verification: [{ type: "create_purchase_order", id: order.purchase_order_id, verified }],
        duplicate: Boolean(order.duplicate),
        currency: order.currency_code || null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "receive_purchase_order")) {
      if (actions.length !== 1) return json({ error: "Goods receipt must be confirmed separately from other actions so inventory changes remain atomic." }, 400, origin);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) return json({ error: "The goods receipt confirmation key is invalid. Please prepare the action again." }, 400, origin);
      const payload = actions[0].payload;
      const { data: receipt, error: receiptError } = await supabase.rpc("india_part4_receive_purchase_order", {
        p_purchase_order_id: payload.purchase_order_id,
        p_warehouse_id: payload.warehouse_id,
        p_idempotency_key: idempotencyKey,
        p_items: payload.items,
      });
      if (receiptError) {
        console.error("Goods receipt rejected", { code: receiptError.code, userId: user.id });
        return json({ error: "The goods receipt could not be completed. Check the purchase order and warehouse, then try again." }, 400, origin);
      }
      if (!receipt?.ok || !receipt?.receipt_id) {
        const reason = String(receipt?.reason || "");
        const message = reason === "forbidden" ? "Your role cannot receive stock into this workspace."
          : reason === "purchase_order_not_found" ? "That purchase order was not found in this workspace."
          : reason === "warehouse_not_found" ? "That warehouse is unavailable or inactive."
          : reason === "receipt_quantity_exceeded" ? "The received quantity exceeds the outstanding purchase-order quantity."
          : reason === "stock_item_not_found" ? "A stock item linked to this purchase order no longer exists."
          : "The goods receipt details were rejected. Nothing was saved.";
        return json({ error: message }, reason === "forbidden" ? 403 : 400, origin);
      }
      const [receiptCheck, receiptItemsCheck, movementCheck] = await Promise.all([
        supabase.from("purchase_receipts").select("id")
          .eq("workspace_id", profile.workspace_id).eq("id", receipt.receipt_id).maybeSingle(),
        supabase.from("purchase_receipt_items").select("stock_id,quantity")
          .eq("workspace_id", profile.workspace_id).eq("receipt_id", receipt.receipt_id),
        supabase.from("stock_movements").select("id")
          .eq("workspace_id", profile.workspace_id).eq("reference_type", "purchase_receipt").eq("reference_id", receipt.receipt_id),
      ]);
      const verified = !receiptCheck.error && Boolean(receiptCheck.data?.id)
        && !receiptItemsCheck.error && receiptItemsCheck.data?.length === payload.items.length
        && !movementCheck.error && movementCheck.data?.length === payload.items.length;
      return json({
        ok: true,
        verified,
        reply: verified ? "Goods receipt saved and verified. Plivex updated the stock ledger." : "The receipt was accepted, but Plivex could not verify it. Check purchase receipts and stock before retrying.",
        created: [{ type: "receive_purchase_order", id: receipt.receipt_id }],
        verification: [{ type: "receive_purchase_order", id: receipt.receipt_id, verified }],
        duplicate: Boolean(receipt.duplicate),
      }, 200, origin);
    }
    const canonical = JSON.stringify(actions);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const requestHash = [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,"0")).join("");
    const { data, error } = await supabase.rpc("execute_assistant_action_batch", {
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
      p_actions: actions,
    });
    if (error) {
      console.error("Assistant batch confirmation rejected", { code: error.code, message: error.message, userId: user.id });
      const message = String(error.message || "");
      if (message.includes("PERMISSION_DENIED")) return json({ error: "Your Plivex role does not have permission for one or more requested actions. Nothing was saved." }, 403, origin);
      if (message.startsWith("PLAN_LIMIT_REACHED|") || message.startsWith("PLAN_FEATURE_LOCKED|")) return json({ error: message }, 409, origin);
      if (message.includes("AUTH_REQUIRED") || message.includes("WORKSPACE_NOT_FOUND")) return json({ error: "Your workspace session could not be verified." }, 403, origin);
      return json({ error: "The action batch could not be completed. No partial records were saved." }, 400, origin);
    }
    const created = Array.isArray(data?.created) ? data.created : [];
    const tableByAction: Record<string, string> = {
      create_client: "clients",
      create_expense: "expenses",
      create_lead: "leads",
      create_stock: "stock",
      create_quotation: "quotations",
      create_invoice: "invoices",
    };
    const verification = await Promise.all(created.map(async (record: any) => {
      const table = tableByAction[text(record?.type, 40)];
      const id = text(record?.id, 80);
      if (!table || !id) return { type: text(record?.type, 40), id: id || null, verified: false };
      const { data: row, error: verifyError } = await supabase
        .from(table)
        .select("id")
        .eq("workspace_id", profile.workspace_id)
        .eq("id", id)
        .maybeSingle();
      return { type: text(record?.type, 40), id, verified: !verifyError && Boolean(row?.id) };
    }));
    const allVerified = actions.length === created.length
      && verification.length === actions.length
      && verification.every((item: any) => item.verified);
    return json({
      ok: true,
      verified: allVerified,
      reply: allVerified
        ? (actions.length === 1 ? "The record was saved and verified in your Plivex workspace." : "All requested records were saved together and verified in your Plivex workspace.")
        : "The save operation was accepted, but Plivex could not verify every created record. Please check the relevant module before retrying.",
      created,
      verification,
      duplicate: Boolean(data?.duplicate),
      batchId: data?.batch_id,
    }, 200, origin);
  } catch (error) {
    console.error("Assistant confirmation failed", error);
    return json({ error: "Something went wrong while confirming the action." }, 500, origin);
  }
});
