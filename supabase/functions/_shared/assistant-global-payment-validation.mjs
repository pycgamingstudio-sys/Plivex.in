const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateGlobalInvoicePaymentAction(action) {
  if (!action || typeof action !== "object" || action.type !== "record_global_invoice_payment") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const invoiceId = String(raw.invoice_id ?? "").trim();
  const amount = Number(raw.amount);
  const currencyCode = String(raw.currency_code ?? "").trim().toUpperCase();
  const paymentDate = String(raw.payment_date ?? "").trim();
  if (!UUID_RE.test(invoiceId) || !Number.isFinite(amount) || amount <= 0
    || !/^[A-Z]{3}$/.test(currencyCode) || !validDate(paymentDate)) return null;
  const clean = (value, max) => String(value ?? "").trim().slice(0, max);
  return {
    type: "record_global_invoice_payment",
    payload: {
      invoice_id: invoiceId, amount, currency_code: currencyCode, payment_date: paymentDate,
      method: clean(raw.method, 80), reference: clean(raw.reference, 160), notes: clean(raw.notes, 1000),
    },
  };
}

/** Convert major currency units to integer minor units using ISO currency precision. */
export function majorToMinorUnits(amount, currencyCode) {
  const value = Number(amount);
  const currency = String(currencyCode ?? "").trim().toUpperCase();
  if (!Number.isFinite(value) || value <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    const scale = 10 ** digits;
    const scaled = value * scale;
    const minor = Math.round(scaled);
    if (!Number.isSafeInteger(minor) || minor <= 0 || Math.abs(scaled - minor) > 1e-7) return null;
    return minor;
  } catch {
    return null;
  }
}
