/**
 * Explicit Global tax capability matrix.
 *
 * Country selection is not tax readiness. This matrix is deliberately
 * conservative: only a country with a maintained adapter may calculate tax,
 * and only a separately implemented issuance adapter may issue an invoice.
 * Unlisted ISO country codes fail closed.
 */
const CAPABILITIES = Object.freeze({
  IN: Object.freeze({
    countryCode: "IN",
    calculation: "india_legacy",
    issuance: "india_legacy",
    taxSystem: "GST",
    currencyCode: "INR",
    note: "Use the existing India GST implementation; never route India through Global tax.",
  }),
  GB: Object.freeze({
    countryCode: "GB",
    calculation: "standard_rate_baseline",
    issuance: "standard_rate_only",
    taxSystem: "VAT",
    currencyCode: "GBP",
    note: "Standard-rated VAT invoices only. Reduced, zero-rated, exempt and reverse-charge treatments remain unsupported.",
  }),
  AE: Object.freeze({
    countryCode: "AE",
    calculation: "standard_rate_baseline",
    issuance: "standard_rate_only",
    taxSystem: "VAT",
    currencyCode: "AED",
    note: "Standard-rated VAT invoices only; designated zones, special treatments and reverse charge remain unsupported.",
  }),
  AU: Object.freeze({
    countryCode: "AU",
    calculation: "standard_rate_baseline",
    issuance: "standard_rate_only",
    taxSystem: "GST",
    currencyCode: "AUD",
    note: "Standard-rated GST invoices only; GST-free, input-taxed and special treatments remain unsupported.",
  }),
  SG: Object.freeze({
    countryCode: "SG",
    calculation: "standard_rate_baseline",
    issuance: "standard_rate_only",
    taxSystem: "GST",
    currencyCode: "SGD",
    note: "Standard-rated GST invoices only; zero-rated, exempt, out-of-scope and reverse-charge treatments remain unsupported.",
  }),
  US: Object.freeze({
    countryCode: "US",
    calculation: "verified_jurisdiction_rule_required",
    issuance: "disabled",
    taxSystem: "Sales tax",
    currencyCode: "USD",
    note: "Requires a verified state/local rule and collection-obligation evidence.",
  }),
  CA: Object.freeze({
    countryCode: "CA",
    calculation: "verified_jurisdiction_rule_required",
    issuance: "standard_rate_only",
    taxSystem: "GST/HST/PST/QST",
    currencyCode: "CAD",
    note: "Standard GST/HST and listed province components only; PST taxable-goods classification must be confirmed. Other product/service exceptions remain unsupported.",
  }),
});

const UNKNOWN = Object.freeze({
  countryCode: null,
  calculation: "not_configured",
  issuance: "disabled",
  taxSystem: null,
  currencyCode: null,
  note: "No verified country tax adapter is configured. Save drafts only; do not calculate or issue tax invoices.",
});

export function getGlobalTaxCapability(countryCode) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(code)) {
    return { ...UNKNOWN, code: "INVALID_COUNTRY_CODE" };
  }
  const capability = CAPABILITIES[code];
  return capability
    ? { ...capability, status: capability.calculation === "india_legacy" ? "india_legacy" : "configured" }
    : { ...UNKNOWN, countryCode: code, status: "not_configured", code: "COUNTRY_TAX_NOT_CONFIGURED" };
}

export function listGlobalTaxCapabilities() {
  return Object.values(CAPABILITIES).map((item) => ({ ...item }));
}
