import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { validateInvoiceAction } from "../_shared/assistant-invoice-validation.mjs";
import { validateGlobalInvoicePaymentAction, majorToMinorUnits } from "../_shared/assistant-global-payment-validation.mjs";
import { validateGlobalClientAction } from "../_shared/assistant-global-client-validation.mjs";
import { validateGlobalSupplierAction } from "../_shared/assistant-global-supplier-validation.mjs";
import { validateGlobalStockTransferAction } from "../_shared/assistant-global-stock-transfer-validation.mjs";
import { validateGlobalBranchAction } from "../_shared/assistant-global-branch-validation.mjs";
import { validateGlobalMemberPermissionAction } from "../_shared/assistant-global-member-permission-validation.mjs";
import { validateGlobalApprovalRequestAction } from "../_shared/assistant-global-approval-validation.mjs";
import { validateGlobalApprovalDecisionAction } from "../_shared/assistant-global-approval-decision-validation.mjs";
import { validateGlobalExpenseAction } from "../_shared/assistant-global-expense-validation.mjs";
import { validateGlobalProductAction } from "../_shared/assistant-global-product-validation.mjs";
import { validateGoodsReceiptAction } from "../_shared/assistant-goods-receipt-validation.mjs";
import { validatePurchaseOrderAction } from "../_shared/assistant-purchase-order-validation.mjs";
import { validateWarehouseAction } from "../_shared/assistant-warehouse-validation.mjs";
import { isGlobalOnlyAssistantAction } from "../_shared/assistant-workspace-action-guard.mjs";

const ALLOWED_ORIGINS = new Set([
  "https://plivex.in",
  "https://www.plivex.in",
  "https://plivex.netlify.app",
  "https://deploy-preview-139--plivex.netlify.app",
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
  if (type === "create_global_product") {
    return validateGlobalProductAction(action);
  }
  if (type === "create_global_expense") {
    return validateGlobalExpenseAction(action);
  }
  if (type === "create_global_client") {
    return validateGlobalClientAction(action);
  }
  if (type === "record_global_invoice_payment") {
    return validateGlobalInvoicePaymentAction(action);
  }
  if (type === "create_warehouse") {
    return validateWarehouseAction(action);
  }
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

    const [profileResult, globalAuthResult] = await Promise.all([
      supabase.from("profiles").select("workspace_id,role").eq("id", user.id).maybeSingle(),
      (async () => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          const invocation = supabase.functions.invoke("global-auth-context", { body: {} })
            .then((result: any) => {
              const status = Number(result.error?.context?.status || 0);
              return { result, unavailable: Boolean(result.error && status !== 403), timedOut: false };
            })
            .catch(() => ({ result: null, unavailable: true, timedOut: false }));
          const timeout = new Promise<{ result: null; unavailable: true; timedOut: true }>((resolve) => {
            timeoutId = setTimeout(() => resolve({ result: null, unavailable: true, timedOut: true }), 2500);
          });
          return await Promise.race([invocation, timeout]);
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
      })(),
    ]);
    if (globalAuthResult?.timedOut || globalAuthResult?.unavailable) return json({ error: "Workspace country context is temporarily unavailable. No action was executed; please retry." }, 503, origin);
    const profileRow = profileResult.data || null;
    const globalUser = !globalAuthResult.result?.error && globalAuthResult.result?.data?.user?.workspace_id
      ? globalAuthResult.result.data.user
      : null;
    const workspaceId = globalUser?.workspace_id || profileRow?.workspace_id || null;
    const isGlobalWorkspace = Boolean(globalUser?.workspace_id);
    if (!workspaceId) return json({ error: "Your Plivex workspace could not be found." }, 403, origin);
    const profile: any = { ...(profileRow || {}), workspace_id: workspaceId };

    const body = await req.json().catch(() => null);
    const rawActions = Array.isArray(body?.actions) ? body.actions : [body?.action];
    if (!rawActions.length || rawActions.length > 10) return json({ error: "Please confirm between 1 and 10 valid actions." }, 400, origin);
    if (isGlobalWorkspace && rawActions.some((action: any) => !["create_global_branch", "create_global_client", "create_global_supplier", "set_global_member_permission", "request_global_approval", "decide_global_approval", "create_global_expense", "create_global_product", "record_global_invoice_payment", "transfer_global_stock"].includes(String(action?.type || "")))) {
      return json({ error: "This Main Workspace action is not connected yet. No legacy India-table write was attempted." }, 403, origin);
    }
    if (!isGlobalWorkspace && rawActions.some((action: any) => isGlobalOnlyAssistantAction(action?.type))) {
      return json({ error: "This Global-only action is not available in the current workspace." }, 403, origin);
    }
    const actions = rawActions.map(validateAction);
    if (actions.some((action: unknown) => !action)) return json({ error: "Some action details are missing or invalid. Nothing was saved." }, 400, origin);
    const idempotencyKey = text(body?.idempotencyKey,160);
    if (idempotencyKey.length < 16) return json({ error: "Confirmation key is missing. Please refresh the pending action and try again." }, 400, origin);
    if (actions.some((action: any) => action.type === "create_global_product")) {
      if (actions.length !== 1) return json({ error: "Global product creation must be confirmed separately so its catalog record remains idempotent." }, 400, origin);
      const payload = actions[0].payload;
      const salePriceMinor = payload.sale_price === null ? null : payload.sale_price === 0 ? 0 : majorToMinorUnits(payload.sale_price, payload.currency_code);
      const purchaseCostMinor = payload.purchase_cost === null ? null : payload.purchase_cost === 0 ? 0 : majorToMinorUnits(payload.purchase_cost, payload.currency_code);
      if ((payload.sale_price !== null && salePriceMinor === null) || (payload.purchase_cost !== null && purchaseCostMinor === null)) {
        return json({ error: "Product price has more decimal places than the workspace currency supports." }, 400, origin);
      }
      const values = {
        name: payload.name, sku: payload.sku || null, description: payload.description || null,
        unit: payload.unit, currency_code: payload.currency_code,
        tax_code: payload.tax_code || null, is_active: payload.is_active,
        ...(salePriceMinor === null ? {} : { sale_price_minor: salePriceMinor }),
        ...(purchaseCostMinor === null ? {} : { purchase_cost_minor: purchaseCostMinor }),
      };
      const canonical = JSON.stringify({ type: "create_global_product", payload: values });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      const requestHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: product, error: productError } = await supabase.rpc("assistant_create_global_product_idempotent", {
        p_workspace_id: workspaceId, p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash, p_values: values,
      });
      if (productError) {
        const message = String(productError.message || "");
        if (message.includes("PERMISSION_DENIED")) return json({ error: "Only a Global workspace owner, admin or manager can create products." }, 403, origin);
        if (message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) return json({ error: "This confirmation key was already used for different product details. Prepare the product again." }, 409, origin);
        console.error("Global product creation rejected", { code: productError.code, userId: user.id });
        return json({ error: "The Global product could not be created. Check the details and try again." }, 400, origin);
      }
      if (!product?.ok || !product?.product_id || !product?.record) {
        const reason = String(product?.reason || "");
        const message = reason === "duplicate_sku" ? "A product with this SKU already exists in the Global catalog. Use the existing product or choose a different SKU."
          : reason === "forbidden" ? "Your Global workspace role cannot create products."
          : reason === "access_denied" ? "You do not have access to this Main Workspace."
          : "The Global product details were rejected. Nothing was saved.";
        return json({ error: message }, reason === "forbidden" || reason === "access_denied" ? 403 : 409, origin);
      }
      const record = product.record;
      const verified = Boolean(record.id === product.product_id
        && record.name === payload.name
        && String(record.currency_code || "").toUpperCase() === payload.currency_code
        && Number(record.sale_price_minor) === (salePriceMinor ?? 0)
        && Number(record.purchase_cost_minor) === (purchaseCostMinor ?? 0)
        && record.unit === payload.unit && record.is_active === payload.is_active
        && (payload.sku ? record.sku === payload.sku : true));
      return json({
        ok: true, verified, duplicate: Boolean(product.duplicate),
        reply: verified
          ? "Global product created and verified in your catalog. No stock quantity was added."
          : "The Global product service accepted the request, but Plivex could not verify the catalog row. Check the product list before retrying.",
        created: [{ type: "create_global_product", id: product.product_id }],
        verification: [{ type: "create_global_product", id: product.product_id, verified }],
        product: verified ? { name: record.name, sku: record.sku || null, unit: record.unit, currency_code: record.currency_code } : null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "create_global_expense")) {
      if (actions.length !== 1) return json({ error: "Global expense creation must be confirmed separately so its ledger entry remains idempotent." }, 400, origin);
      const payload = actions[0].payload;
      const amountMinor = majorToMinorUnits(payload.amount, payload.currency_code);
      if (amountMinor === null) return json({ error: "Expense amount does not match the currency's supported decimal precision." }, 400, origin);
      const values = {
        category: payload.category, vendor: payload.vendor || null,
        amount_minor: amountMinor, currency_code: payload.currency_code,
        expense_date: payload.expense_date || null,
        payment_method: payload.payment_method || null,
        reference: payload.reference || null, notes: payload.notes || null,
      };
      const canonical = JSON.stringify({ type: "create_global_expense", payload: values });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      const requestHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: expense, error: expenseError } = await supabase.rpc("assistant_create_global_expense_idempotent", {
        p_workspace_id: workspaceId, p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash, p_values: values,
      });
      if (expenseError) {
        const message = String(expenseError.message || "");
        if (message.includes("PERMISSION_DENIED")) return json({ error: "Only a Global workspace owner, admin or accountant can record expenses." }, 403, origin);
        if (message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) return json({ error: "This confirmation key was already used for different expense details. Prepare the expense again." }, 409, origin);
        console.error("Global expense creation rejected", { code: expenseError.code, userId: user.id });
        return json({ error: "The Global expense could not be recorded. Check the details and try again." }, 400, origin);
      }
      if (!expense?.ok || !expense?.expense_id || !expense?.record) {
        const reason = String(expense?.reason || "");
        const message = reason === "forbidden" ? "Your Global workspace role cannot record expenses."
          : reason === "access_denied" ? "You do not have access to this Global workspace."
          : "The Global expense details were rejected. Nothing was saved.";
        return json({ error: message }, reason === "forbidden" || reason === "access_denied" ? 403 : 400, origin);
      }
      const record = expense.record;
      const verified = Boolean(record.id === expense.expense_id
        && Number(record.amount_minor) === amountMinor
        && String(record.currency_code || "").toUpperCase() === payload.currency_code
        && record.category === payload.category);
      return json({
        ok: true, verified, duplicate: Boolean(expense.duplicate),
        reply: verified
          ? "Global expense recorded and verified in your workspace."
          : "The Global expense service accepted the request, but Plivex could not verify the stored expense details. Check the expense list before retrying.",
        created: [{ type: "create_global_expense", id: expense.expense_id }],
        verification: [{ type: "create_global_expense", id: expense.expense_id, verified }],
        expense: verified ? { category: record.category, amount_minor: amountMinor, currency_code: payload.currency_code, expense_date: record.expense_date || null } : null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "create_global_client")) {
      if (actions.length !== 1) return json({ error: "Global client creation must be confirmed separately so its workspace record remains idempotent." }, 400, origin);
      const payload = actions[0].payload;
      const canonical = JSON.stringify(actions);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      const requestHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: client, error: clientError } = await supabase.rpc("assistant_create_global_client_idempotent", {
        p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash,
        p_values: payload,
        p_workspace_id: workspaceId,
      });
      if (clientError) {
        console.error("Global client creation rejected", { code: clientError.code, userId: user.id });
        const message = String(clientError.message || "");
        if (message.includes("PERMISSION_DENIED")) return json({ error: "Only a Global workspace owner, admin or manager can create a client." }, 403, origin);
        if (message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) return json({ error: "This confirmation key was already used for different client details. Prepare the client again." }, 409, origin);
        return json({ error: "The Global client could not be created. Check the details and try again." }, 400, origin);
      }
      if (!client?.ok || !client?.client_id) {
        const reason = String(client?.reason || "");
        const message = reason === "forbidden" ? "Your Global workspace role cannot create clients."
          : reason === "access_denied" ? "You do not have access to this Global workspace."
          : reason === "duplicate_client" ? "A Global client with this name or email already exists. Use the existing client instead; no duplicate was created."
          : "The Global client details were rejected. Nothing was saved.";
        return json({ error: message }, reason === "forbidden" || reason === "access_denied" ? 403 : 400, origin);
      }
      const { data: clients, error: verifyError } = await supabase.functions.invoke("global-business-records", {
        body: { action: "list", table: "clients", workspace_id: workspaceId, limit: 100 },
      });
      const verifiedClient = !verifyError && clients?.ok && Array.isArray(clients.records)
        ? clients.records.find((item: any) => item?.id === client.client_id && item?.name === payload.name)
        : null;
      const verified = Boolean(verifiedClient);
      return json({
        ok: true, verified, duplicate: Boolean(client.duplicate),
        reply: verified
          ? "Global client created and verified in your workspace."
          : "The Global client service accepted the request, but Plivex could not verify the new record. Check the client list before retrying.",
        created: [{ type: "create_global_client", id: client.client_id }],
        verification: [{ type: "create_global_client", id: client.client_id, verified }],
        client: verified ? { name: verifiedClient.name, email: verifiedClient.email || null } : null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "create_global_supplier")) {
      if (actions.length !== 1) return json({ error: "Global supplier creation must be confirmed separately so its record and audit event remain atomic." }, 400, origin);
      const payload = actions[0].payload;
      const canonical = JSON.stringify({ type: "create_global_supplier", payload });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      const requestHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: supplier, error: supplierError } = await supabase.rpc("assistant_create_global_supplier_idempotent", {
        p_workspace_id: workspaceId, p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash, p_values: payload,
      });
      if (supplierError) {
        const message = String(supplierError.message || "");
        if (message.includes("PERMISSION_DENIED")) return json({ error: "Only a Main Workspace owner, admin or manager can create suppliers." }, 403, origin);
        if (message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) return json({ error: "This confirmation key was already used for different supplier details. Prepare the supplier again." }, 409, origin);
        console.error("Global supplier creation rejected", { code: supplierError.code, userId: user.id });
        return json({ error: "The Global supplier could not be created. Check the details and try again." }, 400, origin);
      }
      if (!supplier?.ok || !supplier?.supplier_id || !supplier?.record) {
        const reason = String(supplier?.reason || "");
        const message = reason === "duplicate_supplier" ? "A supplier with this name already exists in this workspace. Use the existing supplier instead."
          : reason === "forbidden" ? "Your Main Workspace role cannot create suppliers."
          : reason === "access_denied" ? "You do not have access to this Global workspace."
          : "The Global supplier details were rejected. Nothing was saved.";
        return json({ error: message }, reason === "forbidden" || reason === "access_denied" ? 403 : 409, origin);
      }
      const record = supplier.record;
      const verified = Boolean(record.id === supplier.supplier_id && record.name === payload.name
        && (record.email || null) === (payload.email || null)
        && (record.phone || null) === (payload.phone || null)
        && (record.tax_registration_number || null) === (payload.tax_registration_number || null));
      return json({
        ok: true, verified, duplicate: Boolean(supplier.duplicate),
        reply: verified ? "Global supplier created and verified in your workspace; an audit event was recorded."
          : "The supplier service accepted the request, but Plivex could not verify every field. Check the supplier list before retrying.",
        created: [{ type: "create_global_supplier", id: supplier.supplier_id }],
        verification: [{ type: "create_global_supplier", id: supplier.supplier_id, verified }],
        supplier: verified ? { name: record.name, email: record.email || null, phone: record.phone || null } : null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "decide_global_approval")) {
      if (actions.length !== 1) return json({ error: "Approval decisions must be confirmed one at a time." }, 400, origin);
      const payload = actions[0].payload;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        return json({ error: "The approval decision confirmation key is invalid. Prepare the decision again." }, 400, origin);
      }
      const canonical = JSON.stringify({ type: "decide_global_approval", payload });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      const requestHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: decision, error: decisionError } = await supabase.rpc("assistant_decide_global_approval_idempotent", {
        p_user_id: user.id, p_workspace_id: workspaceId, p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash,
        p_payload: { requestId: payload.request_id, decision: payload.decision, note: payload.note || null },
      });
      if (decisionError) {
        const message = String(decisionError.message || "");
        if (message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) return json({ error: "This confirmation key was already used for a different approval decision. Prepare the decision again." }, 409, origin);
        console.error("Main Workspace approval decision rejected", { code: decisionError.code, userId: user.id });
        return json({ error: "The approval decision could not be submitted. Check the request and your approver permission." }, 400, origin);
      }
      if (!decision?.ok || !decision?.requestId || !["pending", "approved", "rejected"].includes(decision.status)) {
        const code = String(decision?.code || "");
        const message = code === "SELF_APPROVAL_BLOCKED" ? "You cannot approve or reject your own request."
          : code === "APPROVER_ROLE_REQUIRED" || code === "PERMISSION_DENIED" ? "Your Main Workspace role is not authorized to decide this approval."
          : code === "REQUEST_NOT_DECIDABLE" ? "This approval request is no longer pending and cannot be decided again."
          : "The approval decision was not accepted.";
        return json({ error: message }, code === "SELF_APPROVAL_BLOCKED" || code === "APPROVER_ROLE_REQUIRED" || code === "PERMISSION_DENIED" ? 403 : 409, origin);
      }
      let verified = Boolean(decision.status === "approved" || decision.status === "rejected"
        || (decision.status === "pending" && Number.isInteger(decision.currentLevel)
          && Number.isInteger(decision.totalLevels) && decision.currentLevel >= 1
          && decision.currentLevel <= decision.totalLevels));
      if (verified && decision.status === "pending") {
        const { data: list, error: listError } = await supabase.functions.invoke("global-enterprise", {
          body: { action: "approval.list", workspaceId },
        });
        if (!listError && Array.isArray(list?.requests)) {
          const current = list.requests.find((item: any) => item?.id === decision.requestId);
          verified = Boolean(current && current.status === "pending" && current.current_level === decision.currentLevel);
        }
      }
      return json({
        ok: true, verified, duplicate: Boolean(decision.duplicate),
        reply: verified
          ? "Main Workspace approval decision recorded: " + decision.status + ". The approval engine recorded the decision and audit event."
          : "The approval engine accepted the decision, but Plivex could not verify the next pending workflow level. Check the approval queue before retrying.",
        created: [{ type: "decide_global_approval", id: decision.requestId }],
        verification: [{ type: "decide_global_approval", id: decision.requestId, verified }],
        approval: verified ? { id: decision.requestId, decision: payload.decision, status: decision.status, current_level: decision.currentLevel, total_levels: decision.totalLevels } : null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "request_global_approval")) {
      if (actions.length !== 1) return json({ error: "Approval requests must be confirmed one at a time." }, 400, origin);
      const payload = actions[0].payload;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        return json({ error: "The approval request confirmation key is invalid. Prepare the request again." }, 400, origin);
      }
      const canonical = JSON.stringify({ type: "request_global_approval", payload });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      const requestHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: approval, error: approvalError } = await supabase.rpc("assistant_create_global_approval_request_idempotent", {
        p_user_id: user.id, p_workspace_id: workspaceId, p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash,
        p_payload: {
          actionType: payload.action_type, resourceType: payload.resource_type,
          resourceId: payload.resource_id, branchId: payload.branch_id || null,
          payload: payload.details,
        },
      });
      if (approvalError) {
        const message = String(approvalError.message || "");
        if (message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) return json({ error: "This confirmation key was already used for different approval details. Prepare the request again." }, 409, origin);
        console.error("Main Workspace approval request rejected", { code: approvalError.code, userId: user.id });
        return json({ error: "The approval request could not be submitted. Check the source record and your approval.request permission." }, 400, origin);
      }
      if (!approval?.ok || !approval?.requestId) {
        const code = String(approval?.code || "");
        return json({ error: code === "PERMISSION_DENIED" ? "Your Main Workspace role cannot request this approval."
          : code === "INVALID_REQUEST" ? "The approval request details or source record are invalid."
          : "The approval request was not accepted." }, code === "PERMISSION_DENIED" ? 403 : 400, origin);
      }
      const { data: list, error: listError } = await supabase.functions.invoke("global-enterprise", {
        body: { action: "approval.list", workspaceId },
      });
      const record = !listError && Array.isArray(list?.requests)
        ? list.requests.find((item: any) => item?.id === approval.requestId) : null;
      const verified = Boolean(record && record.status === "pending"
        && record.action_type === payload.action_type && record.resource_type === payload.resource_type
        && record.resource_id === payload.resource_id);
      return json({
        ok: true, verified, duplicate: Boolean(approval.duplicate),
        reply: verified ? "Main Workspace approval request submitted and verified in the pending approval queue. The underlying business action has not been executed."
          : "The approval service accepted the request, but Plivex could not verify it in the pending queue. Check approvals before retrying.",
        created: [{ type: "request_global_approval", id: approval.requestId }],
        verification: [{ type: "request_global_approval", id: approval.requestId, verified }],
        approval: verified ? { id: record.id, action_type: record.action_type, resource_type: record.resource_type, status: record.status } : null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "set_global_member_permission")) {
      if (actions.length !== 1) return json({ error: "A Main Workspace member permission change must be confirmed separately." }, 400, origin);
      const payload = actions[0].payload;
      const { data: permission, error: permissionError } = await supabase.functions.invoke("global-enterprise", {
        body: {
          action: "permission.set", workspaceId,
          memberId: payload.member_id, permissionKey: payload.permission_key, effect: payload.effect,
        },
      });
      if (permissionError || !permission?.ok || !permission?.overrideId) {
        const code = String(permission?.error || permission?.code || "");
        return json({ error: code === "ADMIN_REQUIRED" || code === "PERMISSION_DENIED"
          ? "Only a Main Workspace owner or admin can change member permissions."
          : "The Main Workspace permission change was not accepted. Check the member and permission key." },
          code === "ADMIN_REQUIRED" || code === "PERMISSION_DENIED" ? 403 : 400, origin);
      }
      const { data: directory, error: directoryError } = await supabase.rpc("assistant_list_global_members", {
        p_workspace_id: workspaceId, p_limit: 100,
      });
      const member = !directoryError && directory?.ok && Array.isArray(directory.members)
        ? directory.members.find((item: any) => item?.id === payload.member_id) : null;
      const override = Array.isArray(member?.permission_overrides)
        ? member.permission_overrides.find((item: any) => item?.permission_key === payload.permission_key) : null;
      const verified = Boolean(override?.effect === payload.effect);
      return json({
        ok: true, verified,
        reply: verified ? "Main Workspace member permission updated and verified."
          : "The permission service accepted the change, but Plivex could not verify the saved override. Check member permissions before retrying.",
        created: [{ type: "set_global_member_permission", id: permission.overrideId }],
        verification: [{ type: "set_global_member_permission", id: permission.overrideId, verified }],
        permission: verified ? { member_id: payload.member_id, permission_key: payload.permission_key, effect: payload.effect } : null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "create_global_branch")) {
      if (actions.length !== 1) return json({ error: "Main Workspace branch creation must be confirmed separately." }, 400, origin);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        return json({ error: "The branch confirmation key is invalid. Please prepare the branch again." }, 400, origin);
      }
      const payload = actions[0].payload;
      const canonical = JSON.stringify({ type: "create_global_branch", payload });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      const requestHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: branch, error: branchError } = await supabase.rpc("assistant_create_global_branch_idempotent", {
        p_user_id: user.id, p_workspace_id: workspaceId, p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash,
        p_payload: { branchCode: payload.branch_code, name: payload.name, address: payload.address || {} },
      });
      if (branchError) {
        const message = String(branchError.message || "");
        if (message.includes("PERMISSION_DENIED")) return json({ error: "Only a Main Workspace owner or admin can create branches." }, 403, origin);
        if (message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) return json({ error: "This confirmation key was already used for different branch details. Prepare the branch again." }, 409, origin);
        console.error("Main Workspace branch creation rejected", { code: branchError.code, userId: user.id });
        return json({ error: "The branch could not be created. Check its code and details before retrying." }, 400, origin);
      }
      if (!branch?.ok || !branch?.branchId) {
        const code = String(branch?.code || "");
        return json({ error: code === "ADMIN_REQUIRED" ? "Only a Main Workspace owner or admin can create branches."
          : code === "INVALID_BRANCH" ? "The branch name, code or address is invalid."
          : "The Main Workspace branch could not be created." }, code === "ADMIN_REQUIRED" ? 403 : 400, origin);
      }
      const { data: list, error: listError } = await supabase.functions.invoke("global-enterprise", {
        body: { action: "branch.list", workspaceId },
      });
      const record = !listError && Array.isArray(list?.branches)
        ? list.branches.find((item: any) => item?.id === branch.branchId) : null;
      const verified = Boolean(record && record.branch_code === payload.branch_code && record.name === payload.name);
      return json({
        ok: true, verified, duplicate: Boolean(branch.duplicate),
        reply: verified ? "Main Workspace branch created and verified; its creation was recorded in the audit log."
          : "The branch service accepted the request, but Plivex could not verify the saved branch. Check the branch list before retrying.",
        created: [{ type: "create_global_branch", id: branch.branchId }],
        verification: [{ type: "create_global_branch", id: branch.branchId, verified }],
        branch: verified ? { id: record.id, name: record.name, branch_code: record.branch_code } : null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "transfer_global_stock")) {
      if (actions.length !== 1) return json({ error: "A Main Workspace stock transfer must be confirmed separately so the inventory ledger remains atomic." }, 400, origin);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        return json({ error: "The stock transfer confirmation key is invalid. Please prepare the transfer again." }, 400, origin);
      }
      const payload = actions[0].payload;
      const { data: transfer, error: transferError } = await supabase.functions.invoke("global-part4", {
        body: {
          action: "transfer", workspace_id: workspaceId,
          from_warehouse_id: payload.from_warehouse_id,
          to_warehouse_id: payload.to_warehouse_id,
          items: payload.items, idempotency_key: idempotencyKey,
          notes: payload.notes || null,
        },
      });
      if (transferError || !transfer?.ok || !transfer?.transfer_id) {
        const reason = String(transfer?.reason || "");
        const message = reason === "forbidden" ? "Your Main Workspace role cannot transfer stock."
          : reason === "insufficient_stock" ? "The source warehouse no longer has enough stock. No transfer was completed."
          : reason === "warehouse_not_found" ? "One of the selected warehouses is no longer available."
          : reason === "idempotency_conflict" ? "This confirmation key was already used for a different stock transfer."
          : "The stock transfer service could not complete the transfer. Check inventory before retrying.";
        return json({ error: message }, reason === "forbidden" ? 403 : reason === "insufficient_stock" || reason === "idempotency_conflict" ? 409 : 400, origin);
      }
      const [transfersResult, movementsResult] = await Promise.all([
        supabase.functions.invoke("global-part4", { body: { action: "list", resource: "stock_transfers", workspace_id: workspaceId, limit: 500 } }),
        supabase.functions.invoke("global-part4", { body: { action: "list", resource: "warehouse_stock_movements", workspace_id: workspaceId, limit: 500 } }),
      ]);
      const transferRecord = !transfersResult.error && Array.isArray(transfersResult.data?.records)
        ? transfersResult.data.records.find((item: any) => item?.id === transfer.transfer_id) : null;
      const movements = !movementsResult.error && Array.isArray(movementsResult.data?.records)
        ? movementsResult.data.records.filter((item: any) => item?.reference_type === "stock_transfer" && item?.reference_id === transfer.transfer_id)
        : [];
      const expectedMovements = payload.items.length * 2;
      const verified = Boolean(transferRecord
        && transferRecord.from_warehouse_id === payload.from_warehouse_id
        && transferRecord.to_warehouse_id === payload.to_warehouse_id
        && movements.length >= expectedMovements
        && movements.filter((item: any) => item.movement_type === "transfer_out").length >= payload.items.length
        && movements.filter((item: any) => item.movement_type === "transfer_in").length >= payload.items.length);
      return json({
        ok: true, verified, duplicate: Boolean(transfer.duplicate),
        reply: verified
          ? "Main Workspace stock transfer completed and verified in the warehouse movement ledger."
          : "The transfer service accepted the request, but Plivex could not verify every inventory movement. Check both warehouses before retrying.",
        created: [{ type: "transfer_global_stock", id: transfer.transfer_id }],
        verification: [{ type: "transfer_global_stock", id: transfer.transfer_id, verified }],
        transfer: verified ? { from_warehouse_id: payload.from_warehouse_id, to_warehouse_id: payload.to_warehouse_id, product_lines: payload.items.length } : null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "record_global_invoice_payment")) {
      if (actions.length !== 1) return json({ error: "A Global invoice payment must be confirmed separately so its ledger entry remains atomic." }, 400, origin);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        return json({ error: "The payment confirmation key is invalid. Please prepare the action again." }, 400, origin);
      }
      const payload = actions[0].payload;
      const { data: before, error: beforeError } = await supabase.functions.invoke("global-invoices", {
        body: { action: "list_reconciliation", workspace_id: workspaceId, limit: 200 },
      });
      if (beforeError || !before?.ok || !Array.isArray(before.records)) {
        return json({ error: "Global invoice balances could not be verified. No payment was recorded." }, 503, origin);
      }
      const invoice = before.records.find((item: any) => item?.invoice_id === payload.invoice_id);
      if (!invoice) return json({ error: "That invoice is not available in this Global workspace." }, 404, origin);
      if (String(invoice.currency_code || "").toUpperCase() !== payload.currency_code) {
        return json({ error: "Payment currency must match the selected invoice currency." }, 409, origin);
      }
      const outstandingMinor = Number(invoice.outstanding_minor);
      const totalMinor = Number(invoice.total_minor);
      const previousGrossPayments = Number(invoice.gross_payments_minor);
      const payableRemainingMinor = totalMinor - previousGrossPayments;
      if (!Number.isSafeInteger(outstandingMinor) || outstandingMinor <= 0
        || !Number.isSafeInteger(totalMinor) || !Number.isSafeInteger(previousGrossPayments)
        || !Number.isSafeInteger(payableRemainingMinor) || payableRemainingMinor <= 0) {
        return json({ error: "This invoice has no payable balance remaining." }, 409, origin);
      }
      const amountMinor = majorToMinorUnits(payload.amount, payload.currency_code);
      if (amountMinor === null) {
        return json({ error: "Payment amount has more decimal places than the invoice currency supports." }, 400, origin);
      }
      if (amountMinor > payableRemainingMinor) {
        return json({ error: "Payment exceeds this invoice's payable balance. Nothing was recorded." }, 409, origin);
      }
      const { data: payment, error: paymentError } = await supabase.functions.invoke("global-invoices", {
        body: {
          action: "record_payment", workspace_id: workspaceId,
          invoice_id: payload.invoice_id, amount_minor: amountMinor,
          currency_code: payload.currency_code, payment_date: payload.payment_date,
          method: payload.method || null, reference: payload.reference || null,
          notes: payload.notes || null, idempotency_key: idempotencyKey,
        },
      });
      if (paymentError || !payment?.ok || !payment?.payment?.id) {
        const reason = String(payment?.reason || "");
        const message = reason === "forbidden" ? "Your Global workspace role cannot record invoice payments."
          : reason === "overpayment" ? "The payment exceeds the invoice's remaining balance."
          : reason === "invoice_not_payable" ? "This invoice is not in a payable status."
          : reason === "invalid_currency" ? "Payment currency does not match the invoice."
          : reason === "idempotency_conflict" ? "This confirmation was already used for different payment details."
          : "The Global payment ledger rejected this request. No success has been reported.";
        return json({ error: message }, reason === "forbidden" ? 403 : 409, origin);
      }
      const { data: after, error: afterError } = await supabase.functions.invoke("global-invoices", {
        body: { action: "list_reconciliation", workspace_id: workspaceId, limit: 200 },
      });
      const updated = !afterError && after?.ok && Array.isArray(after.records)
        ? after.records.find((item: any) => item?.invoice_id === payload.invoice_id)
        : null;
      const updatedGrossPayments = Number(updated?.gross_payments_minor);
      const updatedOutstanding = Number(updated?.outstanding_minor);
      const verified = Boolean(updated
        && Number.isSafeInteger(previousGrossPayments) && Number.isSafeInteger(updatedGrossPayments)
        && Number.isSafeInteger(updatedOutstanding)
        && String(updated.currency_code || "").toUpperCase() === payload.currency_code
        && (payment.duplicate
          ? updatedGrossPayments >= previousGrossPayments && updatedOutstanding <= outstandingMinor
          : updatedGrossPayments >= previousGrossPayments + amountMinor
            && updatedOutstanding <= outstandingMinor - amountMinor)
        && Number(payment.invoice?.amount_paid_minor) >= amountMinor);
      return json({
        ok: true, verified, duplicate: Boolean(payment.duplicate),
        reply: verified
          ? "Payment recorded and verified in the Global invoice ledger. The invoice balance has been recalculated."
          : "The payment service accepted the request, but Plivex could not verify the updated invoice balance. Check the invoice before retrying.",
        created: [{ type: "record_global_invoice_payment", id: payment.payment.id, invoice_id: payload.invoice_id }],
        verification: [{ type: "record_global_invoice_payment", id: payment.payment.id, verified }],
        payment: verified ? { amount: payload.amount, currency_code: payload.currency_code, payment_date: payload.payment_date } : null,
      }, 200, origin);
    }
    if (actions.some((action: any) => action.type === "create_warehouse")) {
      if (actions.length !== 1) return json({ error: "Warehouse creation must be confirmed separately from other actions." }, 400, origin);
      const payload = actions[0].payload;
      const canonical = JSON.stringify(actions);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      const requestHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: warehouse, error: warehouseError } = await supabase.rpc("assistant_create_warehouse_idempotent", {
        p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash,
        p_name: payload.name,
        p_code: payload.code || null,
        p_address: payload.address || null,
      });
      if (warehouseError) {
        console.error("Warehouse creation rejected", { code: warehouseError.code, userId: user.id });
        const message = String(warehouseError.message || "");
        if (message.includes("PERMISSION_DENIED")) return json({ error: "Only a workspace admin or manager can create a warehouse." }, 403, origin);
        if (message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) return json({ error: "This confirmation key was already used for different warehouse details. Prepare the action again." }, 409, origin);
        return json({ error: "The warehouse could not be created. Check the name and code, then try again." }, 400, origin);
      }
      if (!warehouse?.ok || !warehouse?.warehouse_id) {
        const reason = String(warehouse?.reason || "");
        const message = reason === "warehouse_code_conflict"
          ? "That warehouse code is already used in this workspace. Please provide a different code."
          : "The warehouse details were rejected. Nothing was saved.";
        return json({ error: message }, 400, origin);
      }
      const { data: warehouseRow, error: verifyError } = await supabase.from("warehouses")
        .select("id,code,name,is_active").eq("workspace_id", profile.workspace_id)
        .eq("id", warehouse.warehouse_id).maybeSingle();
      const verifiedWarehouse = !verifyError && warehouseRow?.id && warehouseRow.is_active === true ? warehouseRow : null;
      const verified = Boolean(verifiedWarehouse);
      return json({
        ok: true,
        verified,
        reply: verified ? "Warehouse created and verified in Plivex. It is active and ready for future stock operations." : "The warehouse was accepted, but Plivex could not verify it. Check Warehouses before retrying.",
        created: [{ type: "create_warehouse", id: warehouse.warehouse_id }],
        verification: [{ type: "create_warehouse", id: warehouse.warehouse_id, verified }],
        duplicate: Boolean(warehouse.duplicate),
        warehouse: verifiedWarehouse ? { code: verifiedWarehouse.code, name: verifiedWarehouse.name } : null,
      }, 200, origin);
    }
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
