const asArray = (value) => Array.isArray(value) ? value : [];
const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};

export function validatePurchaseOrderAgainstContext(action, context) {
  if (action?.type !== "create_purchase_order") return { ok: true, summary: action?.summary || "" };
  if (asArray(context?.unavailableModules).includes("stock")) {
    return { ok: false, reason: "stock_context_unavailable" };
  }
  const stock = asArray(context?.records?.stock);
  const descriptions = [];
  for (const requested of asArray(action.payload?.items)) {
    const item = stock.find((record) => record?.id === requested.stock_id);
    if (!item) return { ok: false, reason: "stock_item_not_in_loaded_context" };
    const quantity = finite(requested.quantity_ordered);
    const unitCost = finite(requested.unit_cost);
    if (!(quantity > 0) || !(unitCost >= 0)) return { ok: false, reason: "invalid_line_values" };
    descriptions.push(`${quantity} ${item.unit || ""} ${item.name || "stock item"} at ${unitCost} each`.trim());
  }
  return {
    ok: true,
    summary: `Create purchase order for ${action.payload.supplier_name}: ${descriptions.join(", ")}`,
  };
}
