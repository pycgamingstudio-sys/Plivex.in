const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};
const precision4 = (value) => Number.isSafeInteger(Math.round(value * 10000)) && Math.abs(value * 10000 - Math.round(value * 10000)) < 1e-7;
const realDate = (value) => {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export function validatePurchaseOrderAction(action) {
  if (!action || typeof action !== "object" || clean(action.type, 40) !== "create_purchase_order") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const rawSupplierName = String(raw.supplier_name ?? "").trim();
  const rawReference = String(raw.supplier_reference ?? "").trim();
  const rawNotes = String(raw.notes ?? "").trim();
  if (!rawSupplierName || rawSupplierName.length > 200 || rawReference.length > 120 || rawNotes.length > 500) return null;
  const supplierName = clean(rawSupplierName, 200);
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 200) return null;
  const items = raw.items.map((item) => ({
    stock_id: String(item?.stock_id ?? "").trim(),
    quantity_ordered: finite(item?.quantity_ordered),
    unit_cost: finite(item?.unit_cost),
  }));
  if (new Set(items.map((item) => item.stock_id)).size !== items.length) return null;
  if (items.some((item) =>
    !UUID_RE.test(item.stock_id)
    || !(item.quantity_ordered > 0)
    || !precision4(item.quantity_ordered)
    || !(item.unit_cost >= 0)
    || !precision4(item.unit_cost)
  )) return null;
  const rawExpectedDate = String(raw.expected_date ?? "").trim();
  if (rawExpectedDate.length > 10) return null;
  const expectedDate = clean(rawExpectedDate, 10);
  if (expectedDate && !realDate(expectedDate)) return null;
  return {
    type: "create_purchase_order",
    payload: {
      supplier_name: supplierName,
      supplier_reference: clean(rawReference, 120),
      expected_date: expectedDate || null,
      notes: clean(rawNotes, 500),
      items,
    },
  };
}
