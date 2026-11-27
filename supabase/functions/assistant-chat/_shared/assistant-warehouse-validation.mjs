const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;

export function validateWarehouseAction(action) {
  if (!action || typeof action !== "object" || clean(action.type, 40) !== "create_warehouse") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const rawName = String(raw.name ?? "").trim();
  const rawCode = String(raw.code ?? "").trim();
  const rawAddress = String(raw.address ?? "").trim();
  if (!rawName || rawName.length > 160 || rawCode.length > 32 || rawAddress.length > 500) return null;
  const name = clean(rawName, 160);
  const code = clean(rawCode, 32);
  if (code && !CODE_RE.test(code)) return null;
  return {
    type: "create_warehouse",
    payload: { name, code: code || null, address: rawAddress },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateStockTransferAction(action) {
  if (!action || typeof action !== "object" || clean(action.type, 40) !== "stock_transfer") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const stockId = clean(raw.stock_id, 36);
  const destinationId = clean(raw.to_warehouse_id, 36);
  const quantity = Number(raw.quantity);
  if (!UUID_RE.test(stockId) || !UUID_RE.test(destinationId)) return null;
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(Math.round(quantity * 10000)) || Math.abs(quantity * 10000 - Math.round(quantity * 10000)) > 0.000001) return null;
  return {
    type: "stock_transfer",
    payload: {
      stock_id: stockId,
      to_warehouse_id: destinationId,
      quantity,
      stock_name: clean(raw.stock_name, 120),
      destination_name: clean(raw.destination_name, 120),
    },
  };
}
