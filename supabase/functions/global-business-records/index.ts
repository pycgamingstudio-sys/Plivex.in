import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const TABLE_FIELDS: Record<string, readonly string[]> = {
  clients: ["name", "email", "phone", "tax_registration_number", "billing_address", "shipping_address", "notes", "status"],
  products: ["name", "sku", "description", "unit", "sale_price_minor", "purchase_cost_minor", "currency_code", "tax_code", "is_active"],
  expenses: ["category", "vendor", "amount_minor", "currency_code", "expense_date", "payment_method", "reference", "notes", "attachment_url", "transaction_amount_minor", "transaction_currency_code", "fx_rate_numerator", "fx_rate_denominator", "fx_source_url", "fx_provider", "fx_effective_at"],
  business_profiles: ["legal_name", "display_name", "email", "phone", "address", "tax_registration_number", "tax_registration_type", "tax_registration_status", "tax_registration_effective_from", "tax_jurisdiction_code"],
};
const READ_ONLY_TABLES = new Set(["stock_levels", "stock_movements", "invoices", "invoice_items", "invoice_payments"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 64 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateValues(table: string, values: Record<string, unknown>, creating: boolean): string | null {
  const allowed = TABLE_FIELDS[table];
  if (!allowed) return "This Global record type is read-only.";
  if (Object.keys(values).some((key) => !allowed.includes(key))) return "One or more fields are not supported.";

  const textLimits: Record<string, number> = {
    name: 200, email: 254, phone: 40, tax_registration_number: 80,
    notes: 4000, sku: 80, description: 4000, unit: 32, tax_code: 64,
    category: 100, vendor: 200, payment_method: 80, reference: 160, attachment_url: 2000,
    legal_name: 200, display_name: 200, tax_registration_type: 32, tax_jurisdiction_code: 32, address: 2000,
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
    if (values.currency_code !== undefined && (typeof values.currency_code !== "string" || !CURRENCY.test(values.currency_code))) return "Choose a valid ISO currency code.";
    if (values.is_active !== undefined && typeof values.is_active !== "boolean") return "is_active must be true or false.";
  }
  if (table === "business_profiles" && values.tax_registration_status !== undefined && !["unregistered", "pending", "registered", "deregistered"].includes(String(values.tax_registration_status))) return "Invalid tax registration status.";
  if (table === "business_profiles" && values.tax_registration_effective_from !== undefined && values.tax_registration_effective_from !== null && (typeof values.tax_registration_effective_from !== "string" || !DATE.test(values.tax_registration_effective_from) || Number.isNaN(Date.parse(values.tax_registration_effective_from)))) return "Invalid tax registration effective date.";
  if (table === "expenses") {
    if (creating && (typeof values.category !== "string" || !values.category.trim())) return "Expense category is required.";
    if (values.category !== undefined && (typeof values.category !== "string" || !values.category.trim())) return "Expense category is required.";
    const amount = values.transaction_amount_minor ?? values.amount_minor;
    if (creating && (!Number.isSafeInteger(amount) || Number(amount) <= 0)) return "Expense amount must be a positive integer in transaction-currency minor units.";
    if (values.transaction_amount_minor !== undefined && (!Number.isSafeInteger(values.transaction_amount_minor) || Number(values.transaction_amount_minor) <= 0)) return "Expense amount must be a positive integer in transaction-currency minor units.";
    const currency = values.transaction_currency_code ?? values.currency_code;
    if (currency !== undefined && (typeof currency !== "string" || !CURRENCY.test(currency))) return "Choose a valid ISO transaction currency code.";
    if (values.expense_date !== undefined && (typeof values.expense_date !== "string" || !DATE.test(values.expense_date) || Number.isNaN(Date.parse(values.expense_date)))) return "Expense date must use YYYY-MM-DD.";
    for (const key of ["fx_rate_numerator", "fx_rate_denominator"]) {
      if (values[key] !== undefined && values[key] !== null && (typeof values[key] !== "string" || !/^[1-9][0-9]{0,37}$/.test(values[key]))) return "FX rate must use positive integer numerator and denominator values.";
    }
    if (values.fx_source_url !== undefined && values.fx_source_url !== null && (typeof values.fx_source_url !== "string" || !/^https:\/\//.test(values.fx_source_url) || values.fx_source_url.length > 2000)) return "Enter an HTTPS exchange-rate source URL.";
    if (values.fx_provider !== undefined && values.fx_provider !== null && (typeof values.fx_provider !== "string" || !values.fx_provider.trim() || values.fx_provider.length > 100)) return "Enter the exchange-rate provider name.";
    if (values.fx_effective_at !== undefined && values.fx_effective_at !== null && (typeof values.fx_effective_at !== "string" || !Number.isFinite(Date.parse(values.fx_effective_at)))) return "Enter a valid FX effective timestamp.";
  }
  return null;
}

function rpcStatus(reason: string): number {
  if (reason === "access_denied" || reason === "forbidden" || reason === "read_only") return 403;
  if (reason === "not_found" || reason === "workspace_not_found") return 404;
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
    if (table === "business_profiles" && !["list", "update"].includes(String(action))) return globalJson({ error: "Global business profile supports read and update only." }, 403, origin);

    const recordId = body.id;
    if ((action === "update" || action === "delete") && (typeof recordId !== "string" || !UUID.test(recordId))) {
      return globalJson({ error: "A valid record id is required." }, 400, origin);
    }
    let values: Record<string, unknown> = {};
    if (action === "create" || action === "update") {
      if (!isObject(body.values) || (action === "update" && Object.keys(body.values).length === 0)) {
        return globalJson({ error: "Record values are required." }, 400, origin);
      }
      values = body.values;
      const validationError = validateValues(table, values, action === "create");
      if (validationError) return globalJson({ error: validationError }, 400, origin);
    }

    if (table === "expenses" && action === "create") {
      if (typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)) {
        return globalJson({ error: "A valid expense request id is required." }, 400, origin);
      }
      const { data: expenseData, error: expenseError } = await auth.admin.rpc("global_create_expense_with_fx", {
        p_user_id: auth.user.id,
        p_workspace_id: workspaceId,
        p_category: values.category,
        p_vendor: values.vendor ?? null,
        p_transaction_amount_minor: values.transaction_amount_minor ?? values.amount_minor,
        p_transaction_currency_code: values.transaction_currency_code ?? values.currency_code,
        p_expense_date: values.expense_date || new Date().toISOString().slice(0, 10),
        p_idempotency_key: body.idempotency_key,
        p_rate_numerator: values.fx_rate_numerator ?? null,
        p_rate_denominator: values.fx_rate_denominator ?? null,
        p_source_url: values.fx_source_url ?? null,
        p_provider: values.fx_provider ?? null,
        p_effective_at: values.fx_effective_at ?? null,
        p_notes: values.notes ?? null,
      });
      if (expenseError) {
        console.error("Global FX expense RPC failed", { code: expenseError.code });
        return globalJson({ error: "Global expense service is not ready. Please try again later." }, 503, origin);
      }
      if (!expenseData?.ok) {
        const reason = String(expenseData?.reason || "request_failed");
        const messages: Record<string, string> = {
          access_denied: "You do not have access to this Global workspace.",
          forbidden: "Your workspace role cannot create expenses.",
          workspace_not_found: "Global workspace not found.",
          invalid_expense: "Expense details are invalid.",
          unsupported_base_currency: "The workspace base currency is not supported for FX posting.",
          fx_snapshot_required: "A valid exchange-rate snapshot, source and provider are required for a foreign-currency expense.",
          unnecessary_fx_snapshot: "Do not add an exchange rate when the transaction currency matches the workspace currency.",
          idempotency_conflict: "This expense request id was already used for different expense details.",
        };
        const status = reason === "access_denied" || reason === "forbidden" ? 403 : reason === "workspace_not_found" ? 404 : 400;
        return globalJson({ error: messages[reason] || "Could not create this expense.", reason }, status, origin);
      }
      return globalJson({ ok: true, record: expenseData.record, duplicate: expenseData.duplicate === true }, expenseData.duplicate ? 200 : 201, origin);
    }

    const { data, error } = await auth.admin.rpc("global_business_records", {
      p_user_id: auth.user.id,
      p_workspace_id: workspaceId,
      p_table: table,
      p_action: action,
      p_record_id: recordId || null,
      p_values: values,
      p_limit: Number.isInteger(body.limit) ? Math.min(Math.max(Number(body.limit), 1), 100) : 50,
    });
    if (error) {
      console.error("Global business records RPC failed", { code: error.code });
      return globalJson({ error: "Global records service is not ready. Please try again later." }, 503, origin);
    }
    if (!data?.ok) {
      const reason = String(data?.reason || "request_failed");
      const messages: Record<string, string> = {
        access_denied: "You do not have access to this Global workspace.",
        forbidden: "Your Global workspace role cannot change these records.",
        read_only: "This Global record type is read-only.",
        not_found: "Global record not found.",
        workspace_not_found: "Global workspace not found.",
        invalid_currency: "Record currency must match the Global workspace currency.",
      };
      return globalJson({ error: messages[reason] || "Could not complete the Global records request.", reason }, rpcStatus(reason), origin);
    }
    return globalJson(data, action === "create" ? 201 : 200, origin);
  } catch (error) {
    console.error("global-business-records failed", error);
    return globalJson({ error: "Something went wrong with Global records." }, 500, origin);
  }
});
