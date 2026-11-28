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
