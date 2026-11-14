import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const TABLE_FIELDS: Record<string, readonly string[]> = {
  clients: ["name", "email", "phone", "tax_registration_number", "billing_address", "shipping_address", "notes", "status"],
  products: ["name", "sku", "description", "unit", "sale_price_minor", "purchase_cost_minor", "currency_code", "tax_code", "is_active"],
  expenses: ["category", "vendor", "amount_minor", "currency_code", "expense_date", "payment_method", "reference", "notes", "attachment_url"],
};
const READ_ONLY_TABLES = new Set(["stock_levels", "stock_movements", "invoices", "invoice_items", "invoice_payments"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 64 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateValues(table: string, values: Record<string, unknown>, currencyCode: string, creating: boolean): string | null {
  const allowed = TABLE_FIELDS[table];
  if (!allowed) return "This Global record type is read-only.";
  if (Object.keys(values).some((key) => !allowed.includes(key))) return "One or more fields are not supported.";

  const textLimits: Record<string, number> = {
    name: 200, email: 254, phone: 40, tax_registration_number: 80,
    notes: 4000, sku: 80, description: 4000, unit: 32, tax_code: 64,
    category: 100, vendor: 200, payment_method: 80, reference: 160, attachment_url: 2000,
  };
  for (const [key, value] of Object.entries(values)) {
    if (key in textLimits && value !== null && (typeof value !== "string" || value.length > textLimits[key])) {
      return `Invalid ${key} value.`;
    }
  }
  if (table === "clients") {
    if (creating && (typeof values.name !== "string" || !values.name.trim())) return "Client name is required.";
    if (values.name !== undefined && (typeof values.name !== "string" || !values.name.trim())) return "Client name is required.";
    for (const key of ["billing_address", "shipping_address"]) {
      if (values[key] !== undefined && !isObject(values[key])) return `${key} must be an object.`;
    }
    if (values.status !== undefined && !["active", "archived"].includes(String(values.status))) return "Invalid client status.";
    if (values.email !== undefined && values.email !== null && typeof values.email === "string" && values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return "Enter a valid email address.";
  }
  if (table === "products") {
    if (creating && (typeof values.name !== "string" || !values.name.trim())) return "Product name is required.";
    if (values.name !== undefined && (typeof values.name !== "string" || !values.name.trim())) return "Product name is required.";
    if (values.unit !== undefined && (typeof values.unit !== "string" || !values.unit.trim())) return "Unit is required.";
    for (const key of ["sale_price_minor", "purchase_cost_minor"]) {
      const value = values[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 0)) return `${key} must be a non-negative integer.`;
    }
    if (values.currency_code !== undefined && values.currency_code !== currencyCode) return "Product currency must match the workspace currency.";
    if (values.is_active !== undefined && typeof values.is_active !== "boolean") return "is_active must be true or false.";
  }
  if (table === "expenses") {
    if (creating && (typeof values.category !== "string" || !values.category.trim())) return "Expense category is required.";
    if (values.category !== undefined && (typeof values.category !== "string" || !values.category.trim())) return "Expense category is required.";
    if (creating && (!Number.isSafeInteger(values.amount_minor) || Number(values.amount_minor) <= 0)) return "Expense amount must be a positive integer in minor units.";
    if (values.amount_minor !== undefined && (!Number.isSafeInteger(values.amount_minor) || Number(values.amount_minor) <= 0)) return "Expense amount must be a positive integer in minor units.";
    if (values.currency_code !== undefined && values.currency_code !== currencyCode) return "Expense currency must match the workspace currency.";
    if (values.expense_date !== undefined && (typeof values.expense_date !== "string" || !DATE.test(values.expense_date) || Number.isNaN(Date.parse(values.expense_date)))) return "Expense date must use YYYY-MM-DD.";
  }
  return null;
}

function canWrite(table: string, role: string): boolean {
  if (table === "expenses") return ["owner", "admin", "accountant"].includes(role);
  return ["owner", "admin", "manager"].includes(role);
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
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return globalJson({ error: "Request is too large." }, 413, origin);
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody); } catch { return globalJson({ error: "Invalid JSON request." }, 400, origin); }
    if (!isObject(body)) return globalJson({ error: "Invalid request body." }, 400, origin);

    const workspaceId = body.workspace_id;
    const table = body.table;
    const action = body.action;
    if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) return globalJson({ error: "A valid Global workspace_id is required." }, 400, origin);
    if (typeof table !== "string" || (!Object.hasOwn(TABLE_FIELDS, table) && !READ_ONLY_TABLES.has(table))) {
      return globalJson({ error: "Unsupported Global record type." }, 400, origin);
    }
    if (!["list", "create", "update", "delete"].includes(String(action))) return globalJson({ error: "Unsupported action." }, 400, origin);
    if (action !== "list" && READ_ONLY_TABLES.has(table)) return globalJson({ error: "This Global record type is read-only." }, 403, origin);

    const { data: membership, error: membershipError } = await auth.admin
      .schema("global").from("workspace_members").select("role")
      .eq("workspace_id", workspaceId).eq("user_id", auth.user.id).eq("status", "active").maybeSingle();
    if (membershipError) {
      console.error("Global membership lookup failed", { code: membershipError.code });
      return globalJson({ error: "Could not verify Global workspace access." }, 500, origin);
    }
    if (!membership) return globalJson({ error: "You do not have access to this Global workspace." }, 403, origin);

    const { data: workspace, error: workspaceError } = await auth.admin
      .schema("global").from("workspaces").select("currency_code")
      .eq("id", workspaceId).maybeSingle();
    if (workspaceError || !workspace) return globalJson({ error: "Global workspace not found." }, 404, origin);

    const query = auth.admin.schema("global").from(table);
    if (action === "list") {
      const limit = Number.isInteger(body.limit) ? Math.min(Math.max(Number(body.limit), 1), 100) : 50;
      const orderColumn = table === "stock_levels" ? "product_id"
        : table === "invoice_items" ? "sort_order"
        : table === "invoice_payments" ? "payment_date" : "created_at";
      const { data, error } = await query.select("*").eq("workspace_id", workspaceId)
        .order(orderColumn, { ascending: table === "stock_levels" || table === "invoice_items" })
        .limit(limit);
      if (error) {
        console.error("Global records list failed", { table, code: error.code });
        return globalJson({ error: "Could not load Global records." }, 400, origin);
      }
      return globalJson({ records: data || [] }, 200, origin);
    }

    const role = String(membership.role || "");
    if (!canWrite(table, role)) return globalJson({ error: "Your Global workspace role cannot change these records." }, 403, origin);
    if (action === "create") {
      if (!isObject(body.values)) return globalJson({ error: "Record values are required." }, 400, origin);
      const values = body.values;
      const validationError = validateValues(table, values, workspace.currency_code, true);
      if (validationError) return globalJson({ error: validationError }, 400, origin);
      const { data, error } = await query.insert({ ...values, currency_code: values.currency_code ?? workspace.currency_code, workspace_id: workspaceId, created_by: auth.user.id }).select("*").single();
      if (error) {
        console.error("Global record create failed", { table, code: error.code });
        return globalJson({ error: "Could not create Global record." }, 400, origin);
      }
      return globalJson({ record: data }, 201, origin);
    }

    const recordId = body.id;
    if (typeof recordId !== "string" || !UUID.test(recordId)) return globalJson({ error: "A valid record id is required." }, 400, origin);
    if (action === "update") {
      if (!isObject(body.values) || Object.keys(body.values).length === 0) return globalJson({ error: "Updated record values are required." }, 400, origin);
      const validationError = validateValues(table, body.values, workspace.currency_code, false);
      if (validationError) return globalJson({ error: validationError }, 400, origin);
      const { data, error } = await query.update(body.values).eq("id", recordId).eq("workspace_id", workspaceId).select("*").maybeSingle();
      if (error) {
        console.error("Global record update failed", { table, code: error.code });
        return globalJson({ error: "Could not update Global record." }, 400, origin);
      }
      if (!data) return globalJson({ error: "Global record not found." }, 404, origin);
      return globalJson({ record: data }, 200, origin);
    }

    const { data, error } = await query.delete().eq("id", recordId).eq("workspace_id", workspaceId).select("id").maybeSingle();
    if (error) {
      console.error("Global record delete failed", { table, code: error.code });
      return globalJson({ error: "Could not delete Global record." }, 400, origin);
    }
    if (!data) return globalJson({ error: "Global record not found." }, 404, origin);
    return globalJson({ ok: true, id: data.id }, 200, origin);
  } catch (error) {
    console.error("global-business-records failed", error);
    return globalJson({ error: "Something went wrong with Global records." }, 500, origin);
  }
});
