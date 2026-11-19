const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (value) => {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const cleanText = (value, max) => String(value ?? "").trim().slice(0, max);
const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};

export function validateGoodsReceiptAction(action) {
  if (!action || typeof action !== "object") return null;
  const type = cleanText(action.type, 40);
  if (type !== "receive_purchase_order") return null;
  const payload = action.payload && typeof action.payload === "object" ? action.payload : {};
  const purchaseOrderId = cleanText(payload.purchase_order_id, 36);
  const warehouseId = cleanText(payload.warehouse_id, 36);
  if (!UUID_RE.test(purchaseOrderId) || !UUID_RE.test(warehouseId)) return null;
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 200) return null;

  const items = payload.items.map((item) => {
    const purchaseOrderItemId = cleanText(item?.purchase_order_item_id, 36);
    const quantity = finiteNumber(item?.quantity);
    const batchNumber = cleanText(item?.batch_number, 120);
    const expiresOn = cleanText(item?.expires_on, 10);
    return { purchase_order_item_id: purchaseOrderItemId, quantity, batch_number: batchNumber, expires_on: expiresOn };
  });
  if (new Set(items.map((item) => item.purchase_order_item_id)).size !== items.length) return null;
  if (items.some((item) =>
    !UUID_RE.test(item.purchase_order_item_id)
    || !(item.quantity > 0)
    || Math.round(item.quantity * 10000) !== item.quantity * 10000
    || (item.expires_on && !isRealDate(item.expires_on))
  )) return null;

  return {
    type,
    payload: {
      purchase_order_id: purchaseOrderId,
      warehouse_id: warehouseId,
      items: items.map((item) => ({
        purchase_order_item_id: item.purchase_order_item_id,
        quantity: item.quantity,
        batch_number: item.batch_number,
        expires_on: item.expires_on || null,
      })),
    },
  };
}
