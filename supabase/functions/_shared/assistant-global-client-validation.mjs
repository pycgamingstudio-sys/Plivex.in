const cleanText = (value, max) => String(value ?? "").trim().slice(0, max);

export function validateGlobalClientAction(action) {
  if (!action || typeof action !== "object" || action.type !== "create_global_client") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const name = cleanText(raw.name, 200);
  const email = cleanText(raw.email, 254);
  const phone = cleanText(raw.phone, 40);
  const taxRegistrationNumber = cleanText(raw.tax_registration_number, 80);
  const notes = cleanText(raw.notes, 4000);
  if (!name) return null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return {
    type: "create_global_client",
    payload: {
      name, email, phone, tax_registration_number: taxRegistrationNumber,
      notes, status: "active",
    },
  };
}
