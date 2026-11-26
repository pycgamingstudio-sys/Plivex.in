const asArray = (value) => Array.isArray(value) ? value : [];
const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};

export function validateGoodsReceiptAgainstContext(action, context) {
  if (action?.type !== "receive_purchase_order") return { ok: true, summary: action?.summary || "" };
  const unavailable = new Set(asArray(context?.unavailableModules));
  const requiredModules = ["warehouses", "purchase_orders", "purchase_order_items", "stock"];
  const missing = requiredModules.filter((module) => unavailable.has(module));
  if (missing.length) return { ok: false, reason: "context_unavailable", modules: missing };

  const records = context?.records || {};
  const order = asArray(records.purchase_orders).find((item) => item?.id === action.payload?.purchase_order_id);
  if (!order) return { ok: false, reason: "purchase_order_not_in_loaded_context" };
  const status = String(order.status || "").toLowerCase();
  if (["received", "cancelled", "closed"].includes(status)) return { ok: false, reason: "purchase_order_not_open" };
  const warehouse = asArray(records.warehouses).find((item) => item?.id === action.payload?.warehouse_id && item?.is_active !== false);
  if (!warehouse) return { ok: false, reason: "active_warehouse_not_in_loaded_context" };

  const descriptions = [];
  for (const requested of asArray(action.payload?.items)) {
    const line = asArray(order.items).find((item) => item?.id === requested.purchase_order_item_id);
    if (!line) return { ok: false, reason: "purchase_order_line_not_found" };
    const ordered = finite(line.quantity_ordered);
    const received = finite(line.quantity_received);
    const quantity = finite(requested.quantity);
    if (![ordered, received, quantity].every(Number.isFinite) || quantity <= 0 || quantity > Math.max(0, ordered - received)) {
      return { ok: false, reason: "quantity_exceeds_loaded_outstanding" };
    }
    descriptions.push(`${quantity} ${line.stock_unit || ""} ${line.stock_name || "stock item"}`.trim());
  }
  return {
    ok: true,
    summary: `Receive ${descriptions.join(", ")} against purchase order ${order.supplier_reference || order.id} at ${warehouse.name || "the selected warehouse"}`,
  };
}
