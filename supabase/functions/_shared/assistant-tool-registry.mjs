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
  create_expense: { module: "expenses", approval: "user_confirmation", required: ["amount"] },
  create_lead: { module: "leads", approval: "user_confirmation", required: ["name"] },
  create_stock: { module: "inventory", approval: "user_confirmation", required: ["name", "quantity", "price"] },
  create_quotation: { module: "quotations", approval: "user_confirmation", required: ["client_name", "total"] },
  create_invoice: { module: "invoices", approval: "user_confirmation", required: ["client_name", "items"] },
});

export const BUSINESS_MODULE_CATALOG = Object.freeze({
  clients: { readContext: true, writeTools: ["create_client"] },
  invoices: { readContext: true, writeTools: ["create_invoice"] },
  inventory: { readContext: true, writeTools: ["create_stock"], relatedTables: ["stock", "warehouses", "stock_movements", "inventory_batches"] },
  expenses: { readContext: true, writeTools: ["create_expense"] },
  quotations: { readContext: true, writeTools: ["create_quotation"] },
  leads: { readContext: true, writeTools: ["create_lead"] },
  services: { readContext: true, writeTools: [] },
  suppliers: { readContext: false, writeTools: [], planned: true },
  purchase_orders: { readContext: true, writeTools: [], planned: true },
  purchase_receipts: { readContext: true, writeTools: [], planned: true },
  warehouses: { readContext: true, writeTools: [], planned: true },
  stock_transfers: { readContext: false, writeTools: [], planned: true },
  payments: { readContext: false, writeTools: [], planned: true },
  staff: { readContext: false, writeTools: [], planned: true },
  branches: { readContext: false, writeTools: [], planned: true },
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
