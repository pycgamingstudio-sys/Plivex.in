/**
 * Explicit Global tax capability matrix.
 *
 * Country selection is not legal tax verification. The seven enabled countries
 * can calculate draft_test values from versioned database baselines; only a
 * separately implemented issuance adapter may issue a tax invoice. Unlisted
 * ISO country codes fail closed.
 */
const CAPABILITIES = Object.freeze({
  IN: Object.freeze({
    countryCode: "IN",
    calculation: "india_legacy",
    issuance: "india_legacy",
    taxSystem: "GST",
    currencyCode: "INR",
    note: "Use the existing India GST implementation with versioned draft_test rule snapshots; never imply live GSTN verification.",
  }),
  GB: Object.freeze({
    countryCode: "GB",
    calculation: "draft_test_country_rule",
    issuance: "code_ready_database_migration_pending",
    taxSystem: "VAT",
    currencyCode: "GBP",
    note: "Draft-test standard VAT baseline only; not legally verified and not for production issuance without tax review.",
  }),
  AE: Object.freeze({
    countryCode: "AE",
    calculation: "standard_rate_baseline",
    issuance: "disabled",
    taxSystem: "VAT",
    currencyCode: "AED",
    note: "Draft-test standard VAT baseline only; not legally verified; invoice issuance adapter is disabled.",
  }),
  AU: Object.freeze({
    countryCode: "AU",
    calculation: "standard_rate_baseline",
    issuance: "disabled",
    taxSystem: "GST",
    currencyCode: "AUD",
    note: "Draft-test standard GST baseline only; not legally verified; invoice issuance adapter is disabled.",
  }),
  SG: Object.freeze({
    countryCode: "SG",
    calculation: "standard_rate_baseline",
    issuance: "disabled",
    taxSystem: "GST",
    currencyCode: "SGD",
    note: "Standard-rate calculation only; invoice issuance adapter is not enabled.",
  }),
  US: Object.freeze({
    countryCode: "US",
    calculation: "draft_test_jurisdiction_rule",
    issuance: "disabled",
    taxSystem: "Sales tax",
    currencyCode: "USD",
    note: "Draft-test state baseline only; local city/county taxes and nexus are not included; not legally verified.",
  }),
  CA: Object.freeze({
    countryCode: "CA",
    calculation: "verified_jurisdiction_rule_required",
    issuance: "disabled",
    taxSystem: "GST/HST/PST/QST",
    currencyCode: "CAD",
    note: "Draft-test province/territory baseline only; transaction-specific place-of-supply review is still required.",
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
