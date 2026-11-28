/**
 * Plivex AI tool registry.
 *
 * This registry is deliberately allow-listed. Model output is untrusted input:
 * it can propose only actions that the confirmation RPC currently implements.
 * Broader modules are catalogued for intent recognition, but are not exposed as
 * write tools until a server-side executor, permission rule and tests exist.
 */
export const ASSISTANT_WRITE_TOOLS = Object.freeze({
  create_client: { module: "clients", approval: "user_confirmation", required: ["name"] },
  create_global_branch: { module: "branches", approval: "user_confirmation", required: ["name", "branch_code"] },
  set_global_member_permission: { module: "member_permissions", approval: "user_confirmation", required: ["member_id", "permission_key", "effect"] },
  request_global_approval: { module: "approvals", approval: "user_confirmation", required: ["action_type", "resource_type", "resource_id", "details"] },
  create_global_client: { module: "global_clients", approval: "user_confirmation", required: ["name"] },
  create_global_supplier: { module: "suppliers", approval: "user_confirmation", required: ["name"] },
  transfer_global_stock: { module: "stock_transfers", approval: "user_confirmation", required: ["from_warehouse_id", "to_warehouse_id", "items"] },
  create_global_expense: { module: "global_expenses", approval: "user_confirmation", required: ["category", "amount", "currency_code"] },
  create_global_product: { module: "global_products", approval: "user_confirmation", required: ["name", "currency_code"] },
  create_expense: { module: "expenses", approval: "user_confirmation", required: ["amount"] },
  create_lead: { module: "leads", approval: "user_confirmation", required: ["name"] },
  create_stock: { module: "inventory", approval: "user_confirmation", required: ["name", "quantity", "price"] },
  create_quotation: { module: "quotations", approval: "user_confirmation", required: ["client_name", "total"] },
  create_invoice: { module: "invoices", approval: "user_confirmation", required: ["client_name", "items"] },
  receive_purchase_order: { module: "purchase_receipts", approval: "user_confirmation", required: ["purchase_order_id", "warehouse_id", "items"] },
  create_purchase_order: { module: "purchase_orders", approval: "user_confirmation", required: ["supplier_name", "items"] },
  create_warehouse: { module: "warehouses", approval: "user_confirmation", required: ["name"] },
  record_global_invoice_payment: { module: "payments", approval: "user_confirmation", required: ["invoice_id", "amount", "currency_code", "payment_date"] },
});

export const BUSINESS_MODULE_CATALOG = Object.freeze({
  clients: { readContext: true, writeTools: ["create_client"] },
  global_clients: { readContext: true, writeTools: ["create_global_client"] },
  global_expenses: { readContext: true, writeTools: ["create_global_expense"] },
  global_products: { readContext: true, writeTools: ["create_global_product"] },
  invoices: { readContext: true, writeTools: ["create_invoice"] },
  inventory: { readContext: true, writeTools: ["create_stock"], relatedTables: ["stock", "warehouses", "stock_movements", "inventory_batches", "stock_transfers", "stock_transfer_items"] },
  expenses: { readContext: true, writeTools: ["create_expense"] },
  quotations: { readContext: true, writeTools: ["create_quotation"] },
  leads: { readContext: true, writeTools: ["create_lead"] },
  services: { readContext: true, writeTools: [] },
  suppliers: { readContext: true, writeTools: ["create_global_supplier"], planned: false },
  purchase_orders: { readContext: true, writeTools: ["create_purchase_order"], planned: false },
  purchase_receipts: { readContext: true, writeTools: ["receive_purchase_order"], planned: false },
  warehouses: { readContext: true, writeTools: ["create_warehouse"], planned: false },
  stock_transfers: { readContext: true, writeTools: ["transfer_global_stock"], planned: false },
  payments: { readContext: "summaries_only", writeTools: ["record_global_invoice_payment"], planned: false },
  staff: { readContext: true, writeTools: [], planned: true },
  member_permissions: { readContext: true, writeTools: ["set_global_member_permission"], planned: false },
  approvals: { readContext: true, writeTools: ["request_global_approval"], planned: false },
  branches: { readContext: true, writeTools: ["create_global_branch"], planned: false },
  analytics: { readContext: "summaries_only", writeTools: [] },
  automation: { readContext: false, writeTools: [], planned: true },
});

const stableJson = (value) => {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
};

/**
 * Validate and de-duplicate model-proposed actions before presenting a batch.
 * validateAction must be the server's strict per-action schema validator.
 */
export function normalizeAssistantActionBatch(rawActions, validateAction) {
  if (!Array.isArray(rawActions)) return { actions: [], error: "NOT_AN_ARRAY" };
  if (rawActions.length > 10) return { actions: [], error: "TOO_MANY_ACTIONS" };
  const unique = new Map();
  for (const raw of rawActions) {
    const validated = typeof validateAction === "function" ? validateAction(raw) : null;
    if (!validated || !ASSISTANT_WRITE_TOOLS[validated.type]) {
      return { actions: [], error: "UNSUPPORTED_OR_INVALID_ACTION" };
    }
    unique.set(stableJson(validated), validated);
  }
  return { actions: [...unique.values()], error: null };
}

export function describeToolAvailability() {
  return Object.entries(BUSINESS_MODULE_CATALOG).map(([module, config]) => ({
    module,
    readable: config.readContext === true || config.readContext === "summaries_only",
    writeTools: [...config.writeTools],
    planned: config.planned === true,
  }));
}
