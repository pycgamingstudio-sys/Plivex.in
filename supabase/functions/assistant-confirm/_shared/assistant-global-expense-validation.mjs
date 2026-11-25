import { majorToMinorUnits } from "./assistant-global-payment-validation.mjs";

const cleanText = (value, max) => String(value ?? "").trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateGlobalExpenseAction(action) {
  if (!action || typeof action !== "object" || action.type !== "create_global_expense") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const category = cleanText(raw.category, 100);
  const amount = Number(raw.amount);
  const currencyCode = cleanText(raw.currency_code, 3).toUpperCase();
  const expenseDate = cleanText(raw.expense_date, 10);
  if (!category || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currencyCode)) return null;
  if (expenseDate && !validDate(expenseDate)) return null;
  if (majorToMinorUnits(amount, currencyCode) === null) return null;
  return {
    type: "create_global_expense",
    payload: {
      category, amount, currency_code: currencyCode,
      expense_date: expenseDate || null,
      vendor: cleanText(raw.vendor, 200),
      payment_method: cleanText(raw.payment_method, 80),
      reference: cleanText(raw.reference, 160),
      notes: cleanText(raw.notes, 4000),
    },
  };
}
