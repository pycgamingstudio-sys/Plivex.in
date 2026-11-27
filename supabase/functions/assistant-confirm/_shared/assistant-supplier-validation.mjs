const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateSupplierInviteAction(action) {
  if (!action || typeof action !== "object" || clean(action.type, 40) !== "invite_supplier") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const supplierName = clean(raw.supplier_name, 200);
  const email = clean(raw.email, 254).toLowerCase();
  if (supplierName.length < 2 || !EMAIL_RE.test(email)) return null;
  return { type: "invite_supplier", payload: { supplier_name: supplierName, email } };
}
