const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const validQuantity = (value) => typeof value === "number" && Number.isFinite(value)
  && value > 0 && value <= 1_000_000_000 && Math.round(value * 10000) === value * 10000;

export function validateGlobalStockTransferAction(action) {
  if (!action || typeof action !== "object" || action.type !== "transfer_global_stock") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const fromWarehouseId = clean(raw.from_warehouse_id, 36);
  const toWarehouseId = clean(raw.to_warehouse_id, 36);
  const notes = clean(raw.notes, 1000);
  if (!UUID_RE.test(fromWarehouseId) || !UUID_RE.test(toWarehouseId) || fromWarehouseId === toWarehouseId) return null;
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 200) return null;
  const items = raw.items.map((item) => ({
    product_id: clean(item?.product_id, 36),
    quantity: item?.quantity,
  }));
  if (new Set(items.map((item) => item.product_id)).size !== items.length) return null;
  if (items.some((item) => !UUID_RE.test(item.product_id) || !validQuantity(item.quantity))) return null;
  return {
    type: "transfer_global_stock",
    payload: {
      from_warehouse_id: fromWarehouseId,
      to_warehouse_id: toWarehouseId,
      items,
      notes,
    },
  };
}


export function validateGlobalStockTransferAgainstContext(action, context) {
  if (!action || action.type !== "transfer_global_stock" || !context || context.context_unavailable) {
    return { ok: false, reason: "context_unavailable" };
  }
  const warehouses = Array.isArray(context.warehouses) ? context.warehouses : [];
  const levels = Array.isArray(context.warehouse_stock_levels) ? context.warehouse_stock_levels : [];
  const products = Array.isArray(context.products) ? context.products : [];
  if (!Array.isArray(context.warehouses) || !Array.isArray(context.warehouse_stock_levels) || !Array.isArray(context.products)) {
    return { ok: false, reason: "context_unavailable" };
  }
  const from = warehouses.find((item) => item?.id === action.payload.from_warehouse_id && item?.is_active !== false);
  const to = warehouses.find((item) => item?.id === action.payload.to_warehouse_id && item?.is_active !== false);
  if (!from || !to) return { ok: false, reason: "warehouse_not_found" };
  for (const line of action.payload.items) {
    const product = products.find((item) => item?.id === line.product_id && item?.is_active !== false);
    if (!product) return { ok: false, reason: "product_not_found" };
    const sourceLevel = levels.find((item) => item?.warehouse_id === from.id && item?.product_id === product.id);
    const available = Number(sourceLevel?.quantity ?? 0);
    if (!Number.isFinite(available) || available < line.quantity) {
      return { ok: false, reason: "insufficient_loaded_stock", product_name: product.name || product.id };
    }
  }
  return {
    ok: true,
    summary: "Transfer " + action.payload.items.length + " product line(s) from " + from.name + " to " + to.name
      + ". Available source quantities were checked against the current workspace snapshot; stock will move only after your confirmation.",
  };
}
