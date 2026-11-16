/**
 * Product capability matrix, not a legal-compliance certification.
 * Country selection alone never establishes registration, nexus or taxability.
 */
const MATRIX = Object.freeze({
  IN: { currency: "INR", tax: "legacy_gst", automaticTax: "legacy_path", invoice: "india_gst", fx: "snapshot_only", readiness: "existing_india_path", limitation: "India GST remains on the existing India implementation." },
  US: { currency: "USD", tax: "jurisdiction_adapter", automaticTax: "verified_rule_required", invoice: "jurisdiction_review", fx: "snapshot_only", readiness: "limited", limitation: "State/local rates, taxability, seller nexus and invoice disclosures require exact verified jurisdiction evidence." },
  GB: { currency: "GBP", tax: "standard_rate_baseline", automaticTax: "verified_standard_only", invoice: "vat_fields_limited", fx: "snapshot_only", readiness: "limited", limitation: "Standard-rate checklist only; reduced/zero/exempt, special schemes and exceptions require maintained verified rules and review." },
  AE: { currency: "AED", tax: "standard_rate_baseline", automaticTax: "verified_standard_only", invoice: "vat_fields_limited", fx: "snapshot_only", readiness: "limited", limitation: "AED-only tax invoice path; foreign-currency tax invoice conversion and UAE line-rounding rules are not implemented." },
  CA: { currency: "CAD", tax: "jurisdiction_adapter", automaticTax: "verified_rule_required", invoice: "jurisdiction_review", fx: "snapshot_only", readiness: "limited", limitation: "GST/HST/PST and invoice disclosures depend on place of supply and province; exact jurisdiction rules required." },
  AU: { currency: "AUD", tax: "standard_rate_baseline", automaticTax: "verified_standard_only", invoice: "gst_fields_limited", fx: "snapshot_only", readiness: "limited", limitation: "GST standard-rate checklist only; special supplies and tax-invoice exceptions require review." },
  SG: { currency: "SGD", tax: "standard_rate_baseline", automaticTax: "verified_standard_only", invoice: "gst_fields_limited", fx: "snapshot_only", readiness: "limited", limitation: "Full tax-invoice checklist only; simplified invoice eligibility is not automatically determined." },
});
export function getCountryCapabilities(countryCode) {
  if (typeof countryCode !== "string") return null;
  const code = countryCode.trim().toUpperCase();
  const entry = Object.hasOwn(MATRIX, code) ? MATRIX[code] : null;
  return entry ? Object.freeze({ countryCode: code, ...entry }) : null;
}
export function listCountryCapabilities() {
  return Object.entries(MATRIX).map(([countryCode, value]) => ({ countryCode, ...value }));
}
