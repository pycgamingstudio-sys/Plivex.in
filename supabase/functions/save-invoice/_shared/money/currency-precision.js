// Bundled copy for the save-invoice Edge Function. Keep in sync with src/global/money/currency-precision.js.
/**
 * Explicit ISO 4217 minor-unit metadata for Global financial calculations.
 * This list is intentionally allow-listed; unknown currencies fail closed.
 */
const ENTRIES = [
  ["INR", 2], ["USD", 2], ["EUR", 2], ["GBP", 2], ["AED", 2],
  ["CAD", 2], ["AUD", 2], ["SGD", 2], ["JPY", 0], ["KRW", 0],
  ["KWD", 3], ["BHD", 3], ["OMR", 3], ["JOD", 3],
];
export const CURRENCY_PRECISION = Object.freeze(Object.fromEntries(ENTRIES));
export function getCurrencyPrecision(code) {
  if (typeof code !== "string") return null;
  const normalized = code.trim().toUpperCase();
  return Object.hasOwn(CURRENCY_PRECISION, normalized) ? CURRENCY_PRECISION[normalized] : null;
}
export function assertMinorAmount(amountMinor, currencyCode) {
  if (!Number.isSafeInteger(amountMinor)) throw new TypeError("amountMinor must be a safe integer");
  const precision = getCurrencyPrecision(currencyCode);
  if (precision === null) throw new RangeError("Unsupported currency precision");
  return { amountMinor, currencyCode: currencyCode.trim().toUpperCase(), minorUnits: precision };
}
