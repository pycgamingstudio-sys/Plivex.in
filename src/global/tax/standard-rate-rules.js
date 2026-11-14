/**
 * Reviewed headline standard-rate baselines, not a universal rate table.
 * Only standard-rated supplies may use these. Category, registration,
 * place-of-supply and invoice-date evidence remain mandatory.
 */
const RULES = Object.freeze({
  GB: Object.freeze({
    id: "GB-VAT-STANDARD-2026-11", version: "2026.11",
    countryCode: "GB", currencyCode: "GBP", treatment: "standard",
    effectiveFrom: "2026-01-01", reviewedOn: "2026-11-14",
    source: "https://www.gov.uk/vat-rates", taxName: "VAT",
    rateBps: 2000, coverage: "standard-rate-only",
  }),
  AE: Object.freeze({
    id: "AE-VAT-STANDARD-2026-11", version: "2026.11",
    countryCode: "AE", currencyCode: "AED", treatment: "standard",
    effectiveFrom: "2026-01-01", reviewedOn: "2026-11-14",
    source: "https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/",
    taxName: "VAT", rateBps: 500, coverage: "standard-rate-only",
  }),
  AU: Object.freeze({
    id: "AU-GST-STANDARD-2026-11", version: "2026.11",
    countryCode: "AU", currencyCode: "AUD", treatment: "standard",
    effectiveFrom: "2026-01-01", reviewedOn: "2026-11-14",
    source: "https://www.ato.gov.au/Business/GST/",
    taxName: "GST", rateBps: 1000, coverage: "standard-rate-only",
  }),
  SG: Object.freeze({
    id: "SG-GST-STANDARD-2026-11", version: "2026.11",
    countryCode: "SG", currencyCode: "SGD", treatment: "standard",
    effectiveFrom: "2026-01-01", reviewedOn: "2026-11-14",
    source: "https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/current-gst-rates",
    taxName: "GST", rateBps: 900, coverage: "standard-rate-only",
  }),
});

export function getCountryStandardRateRule(countryCode) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  const rule = RULES[code];
  if (!rule) return null;
  return {
    ...rule,
    verified: true,
    components: [{
      id: rule.id,
      name: rule.taxName,
      rateBps: rule.rateBps,
      source: rule.source,
    }],
  };
}
