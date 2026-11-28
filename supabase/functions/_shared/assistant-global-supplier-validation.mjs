const cleanText = (value, max) => String(value ?? "").trim().slice(0, max);

export function validateGlobalSupplierAction(action) {
  if (!action || typeof action !== "object" || action.type !== "create_global_supplier") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const name = cleanText(raw.name, 200);
  const email = cleanText(raw.email, 254).toLowerCase();
  const phone = cleanText(raw.phone, 40);
  const taxRegistrationNumber = cleanText(raw.tax_registration_number, 80);
  if (!name || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  return {
    type: "create_global_supplier",
    payload: { name, email: email || null, phone: phone || null, tax_registration_number: taxRegistrationNumber || null },
  };
}
