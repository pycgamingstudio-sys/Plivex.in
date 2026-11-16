/**
 * Product capability matrix, not a legal-compliance certification.
 * Unsupported/adapter-required tax treatments must never be auto-calculated.
 */
const MATRIX = Object.freeze({
  IN: { currency: "INR", tax: "legacy_gst", automaticTax: "legacy_path", invoice: "india_gst", fx: "snapshot_only" },
  US: { currency: "USD", tax: "jurisdiction_adapter", automaticTax: "verified_rule_required", invoice: "limited_sales_tax", fx: "snapshot_only" },
  GB: { currency: "GBP", tax: "standard_rate_baseline", automaticTax: "verified_standard_only", invoice: "vat_fields_limited", fx: "snapshot_only" },
  AE: { currency: "AED", tax: "standard_rate_baseline", automaticTax: "verified_standard_only", invoice: "vat_fields_limited", fx: "snapshot_only" },
  CA: { currency: "CAD", tax: "jurisdiction_adapter", automaticTax: "verified_rule_required", invoice: "limited_gst_hst", fx: "snapshot_only" },
  AU: { currency: "AUD", tax: "standard_rate_baseline", automaticTax: "verified_standard_only", invoice: "gst_fields_limited", fx: "snapshot_only" },
  SG: { currency: "SGD", tax: "standard_rate_baseline", automaticTax: "verified_standard_only", invoice: "gst_fields_limited", fx: "snapshot_only" },
});
export function getCountryCapabilities(countryCode) {
  if (typeof countryCode !== "string") return null;
  const code = countryCode.trim().toUpperCase();
  const entry = MATRIX[code];
  return entry ? Object.freeze({ countryCode: code, ...entry }) : null;
}
export function listCountryCapabilities() {
  return Object.entries(MATRIX).map(([countryCode, value]) => ({ countryCode, ...value }));
}
