// Bundled copy for the save-invoice Edge Function. Keep in sync with src/global/tax/tax-treatment-policy.js.
/** Only standard-rated taxable supplies are supported for manual Global tax. */
export const SUPPORTED_MANUAL_TAX_TREATMENTS = Object.freeze(["standard-rated"]);
export function normalizeManualTaxTreatment(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}
export function isSupportedManualTaxTreatment(value) {
  return SUPPORTED_MANUAL_TAX_TREATMENTS.includes(normalizeManualTaxTreatment(value));
}
