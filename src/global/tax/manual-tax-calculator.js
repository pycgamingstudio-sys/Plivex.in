/**
 * Explicit user-selected tax calculation for non-India Global invoices.
 * Results are intentionally marked manual_unverified: user-entered rates are
 * not official tax advice and do not establish registration or collection duties.
 */
import { isSupportedManualTaxTreatment } from "./tax-treatment-policy.js";

const CURRENCY_MINOR_UNITS = Object.freeze({ USD: 2, GBP: 2, AED: 2, CAD: 2, AUD: 2, SGD: 2 });

const fail = (code, message) => ({ ok: false, status: "needs_review", code, message });
const roundDiv = (n, d) => Math.floor((n + Math.floor(d / 2)) / d);

export function calculateManualTax(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("INVALID_INPUT", "Manual tax input is required.");
  const countryCode = String(input.countryCode || "").toUpperCase();
  if (!["US", "GB", "AE", "CA", "AU", "SG"].includes(countryCode)) {
    return fail("UNSUPPORTED_COUNTRY", "Manual Global tax is unavailable for this country; India uses its existing GST path.");
  }
  const currencyCode = String(input.currencyCode || "").toUpperCase();
  if (!Object.hasOwn(CURRENCY_MINOR_UNITS, currencyCode) || CURRENCY_MINOR_UNITS[currencyCode] !== input.currencyMinorUnits) {
    return fail("INVALID_CURRENCY", "A supported country currency and its minor-unit precision are required.");
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) return fail("INVALID_AMOUNT", "Amount must be a non-negative safe integer in minor units.");
  if (!["inclusive", "exclusive"].includes(input.priceMode)) return fail("PRICE_MODE_REQUIRED", "Choose whether the entered price includes tax.");
  if (!isSupportedManualTaxTreatment(input.taxTreatment)) return fail("UNSUPPORTED_TAX_TREATMENT", "Only standard-rated supplies are supported for manual tax components.");
  if (!Array.isArray(input.components) || input.components.length < 1 || input.components.length > 8) return fail("INVALID_COMPONENTS", "Enter one to eight tax components.");
  const ids = new Set();
  for (const item of input.components) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim()
      || ids.has(item.id) || !Number.isInteger(item.rateBps) || item.rateBps < 0 || item.rateBps > 10000) {
      return fail("INVALID_COMPONENT", "Each manually selected component needs a unique ID and a rate from 0% to 100%.");
    }
    ids.add(item.id);
  }
  if ((countryCode === "US" || countryCode === "CA") && input.jurisdictionConfirmed !== true) {
    return fail("JURISDICTION_CONFIRMATION_REQUIRED", "Confirm the applicable state/province and local jurisdiction before entering manual rates.");
  }
  const rateBps = input.components.reduce((sum, item) => sum + item.rateBps, 0);
  if (rateBps > 10000) return fail("COMBINED_RATE_TOO_HIGH", "Combined manual tax rate cannot exceed 100%.");
  const amount = input.amountMinor;
  if (!Number.isSafeInteger(amount * 10000) || !Number.isSafeInteger(amount * rateBps)) {
    return fail("AMOUNT_OUT_OF_RANGE", "Amount exceeds safe integer calculation limits.");
  }
  const taxableMinor = input.priceMode === "exclusive" ? amount : roundDiv(amount * 10000, 10000 + rateBps);
  const totalMinor = input.priceMode === "exclusive" ? amount + roundDiv(amount * rateBps, 10000) : amount;
  const taxMinor = totalMinor - taxableMinor;
  if (![taxableMinor, totalMinor, taxMinor].every(Number.isSafeInteger)) return fail("AMOUNT_OUT_OF_RANGE", "Calculated total exceeds supported limits.");
  const components = input.components.map((item) => ({
    id: item.id, name: String(item.name || item.id), rateBps: item.rateBps,
    amountMinor: roundDiv(taxableMinor * item.rateBps, 10000), source: "user-entered",
  }));
  const calculated = components.reduce((sum, item) => sum + item.amountMinor, 0);
  components[components.length - 1].amountMinor += taxMinor - calculated;
  return {
    ok: true, status: "manual_unverified", warning: "User-selected rates are not independently verified. Confirm tax treatment and collection obligations with an appropriate tax professional or official source.",
    countryCode, currencyCode, currencyMinorUnits: input.currencyMinorUnits,
    priceMode: input.priceMode, taxableMinor, taxMinor, totalMinor, components,
  };
}
