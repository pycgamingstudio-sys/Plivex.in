const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;

export function validateWarehouseAction(action) {
  if (!action || typeof action !== "object" || clean(action.type, 40) !== "create_warehouse") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const name = clean(raw.name, 160);
  const code = clean(raw.code, 32);
  if (!name || (code && !CODE_RE.test(code))) return null;
  return {
    type: "create_warehouse",
    payload: { name, code: code || null, address: clean(raw.address, 500) },
  };
}
