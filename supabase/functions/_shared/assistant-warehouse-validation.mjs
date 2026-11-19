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
    payload: { name, code: code || null, address: clean(raw.address, 500) },
  };
}
