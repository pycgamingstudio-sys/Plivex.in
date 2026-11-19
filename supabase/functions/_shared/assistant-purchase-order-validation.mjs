const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};
const realDate = (value) => {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export function validatePurchaseOrderAction(action) {
  if (!action || typeof action !== "object" || clean(action.type, 40) !== "create_purchase_order") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const supplierName = clean(raw.supplier_name, 200);
  if (!supplierName || !Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 200) return null;
  const items = raw.items.map((item) => ({
    stock_id: clean(item?.stock_id, 36),
    quantity_ordered: finite(item?.quantity_ordered),
    unit_cost: finite(item?.unit_cost),
  }));
  if (new Set(items.map((item) => item.stock_id)).size !== items.length) return null;
  if (items.some((item) =>
    !UUID_RE.test(item.stock_id)
    || !(item.quantity_ordered > 0)
    || Math.round(item.quantity_ordered * 10000) !== item.quantity_ordered * 10000
    || !(item.unit_cost >= 0)
    || Math.round(item.unit_cost * 10000) !== item.unit_cost * 10000
  )) return null;
  const expectedDate = clean(raw.expected_date, 10);
  if (expectedDate && !realDate(expectedDate)) return null;
  return {
    type: "create_purchase_order",
    payload: {
      supplier_name: supplierName,
      supplier_reference: clean(raw.supplier_reference, 120),
      expected_date: expectedDate || null,
      notes: clean(raw.notes, 500),
      items,
    },
  };
}
