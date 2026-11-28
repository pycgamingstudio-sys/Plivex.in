export const GLOBAL_ONLY_ASSISTANT_ACTIONS = Object.freeze([
  "create_global_branch",
  "create_global_client",
  "set_global_member_permission",
  "create_global_expense",
  "create_global_product",
  "create_global_supplier",
  "transfer_global_stock",
  "record_global_invoice_payment",
  "request_global_approval",
]);

export function isGlobalOnlyAssistantAction(type) {
  return GLOBAL_ONLY_ASSISTANT_ACTIONS.includes(String(type || ""));
}
