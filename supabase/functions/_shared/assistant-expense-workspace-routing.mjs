export function routeExpenseActionForWorkspace(action, { isGlobalWorkspace = false, currencyCode = "INR" } = {}) {
  if (!action || typeof action !== "object" || action.type !== "create_expense" || !isGlobalWorkspace) return action;
  const payload = action.payload && typeof action.payload === "object" ? action.payload : {};
  const amount = Number(payload.amount);
  const currency = String(currencyCode || "").trim().toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  return {
    type: "create_global_expense",
    payload: {
      category: String(payload.category || "Other").trim() || "Other",
      amount,
      currency_code: currency,
      expense_date: payload.expense_date || payload.date || null,
      vendor: String(payload.vendor || "").trim(),
      payment_method: String(payload.payment_method || payload.method || "").trim(),
      reference: String(payload.reference || "").trim(),
      notes: String(payload.notes || "").trim(),
    },
  };
}
