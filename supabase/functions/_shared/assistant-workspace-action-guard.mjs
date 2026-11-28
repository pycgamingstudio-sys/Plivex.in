export const GLOBAL_ONLY_ASSISTANT_ACTIONS = Object.freeze([
  "create_global_client",
  "create_global_expense",
  "create_global_product",
  "create_global_supplier",
  "record_global_invoice_payment",
]);

export function isGlobalOnlyAssistantAction(type) {
  return GLOBAL_ONLY_ASSISTANT_ACTIONS.includes(String(type || ""));
}
