/**
 * Versioned, source-controlled tax rule catalogue for Plivex Global.
 *
 * This catalogue contains only the narrow standard-rate baselines already
 * reviewed for GB, AE, AU and SG. It is not a complete tax-law database.
 * US/CA deliberately have no national rate; India remains on its legacy GST
 * adapter. Unknown, out-of-period and jurisdiction-dependent cases fail closed.
 *
 * Update policy:
 * - Add a new immutable version for every legal/rate change; never overwrite
 *   the meaning of an issued invoice's rule snapshot.
 * - Keep legal effective dates separate from review/publication dates.
 * - Cite an official tax authority source for every rate component.
 * - Do not promote a rule to active until its scope and effective dates are
 *   reviewed. This code catalogue is not a live database or legal advice.
 */
export const TAX_RULE_CATALOG_VERSION = "2026.11.1";
export const TAX_ENGINE_VERSION = "1.0.0";

const freezeRule = (rule) => Object.freeze({
  ...rule,
  components: Object.freeze(rule.components.map((component) => Object.freeze({ ...component }))),
});

const COUNTRY_PROFILES = Object.freeze({
  IN: Object.freeze({
    countryCode: "IN", taxSystem: "GST", currencyCode: "INR",
    ruleMode: "india_legacy", issuance: "india_legacy",
    coverage: "existing-india-gst-adapter",
    note: "India continues through the established GST implementation; it is not routed through the Global tax engine.",
  }),
  US: Object.freeze({
    countryCode: "US", taxSystem: "Sales tax", currencyCode: "USD",
    ruleMode: "jurisdiction_required", issuance: "disabled",
    coverage: "state-local-jurisdiction-required",
    note: "No national sales-tax rate is assumed. A verified state/local rule and collection-obligation evidence are required.",
  }),
  GB: Object.freeze({
    countryCode: "GB", taxSystem: "VAT", currencyCode: "GBP",
    ruleMode: "standard_rate_baseline", issuance: "code_ready_database_migration_pending",
    coverage: "standard-rate-only",
    note: "Only the source-backed standard-rate baseline is catalogued. Reduced, zero-rated, exempt, reverse-charge and special treatments are not covered.",
  }),
  AE: Object.freeze({
    countryCode: "AE", taxSystem: "VAT", currencyCode: "AED",
    ruleMode: "standard_rate_baseline", issuance: "disabled",
    coverage: "standard-rate-only",
    note: "Only the source-backed standard-rate baseline is catalogued. Special zones, designated zones, zero-rating, exemptions and reverse-charge are not covered.",
  }),
  CA: Object.freeze({
    countryCode: "CA", taxSystem: "GST/HST/PST/QST", currencyCode: "CAD",
    ruleMode: "jurisdiction_required", issuance: "disabled",
    coverage: "province-territory-jurisdiction-required",
    note: "No single Canada-wide combined rate is assumed. Province/territory and place-of-supply rules must be resolved independently.",
  }),
  AU: Object.freeze({
    countryCode: "AU", taxSystem: "GST", currencyCode: "AUD",
    ruleMode: "standard_rate_baseline", issuance: "disabled",
    coverage: "standard-rate-only",
    note: "Only the source-backed standard-rate baseline is catalogued. GST-free, input-taxed, import and special treatments are not covered.",
  }),
  SG: Object.freeze({
    countryCode: "SG", taxSystem: "GST", currencyCode: "SGD",
    ruleMode: "standard_rate_baseline", issuance: "disabled",
    coverage: "standard-rate-only",
    note: "Only the source-backed standard-rate baseline is catalogued. Zero-rated, exempt, reverse-charge and special schemes are not covered.",
  }),
});

const RULES = Object.freeze({
  GB: freezeRule({
    id: "GB-VAT-STANDARD-2026-11", version: "2026.11",
    countryCode: "GB", currencyCode: "GBP", taxName: "VAT",
    treatment: "standard", rateBps: 2000,
    effectiveFrom: "2011-01-04", effectiveTo: null,
    reviewedOn: "2026-11-14",
    source: "https://www.gov.uk/vat-rates",
    sourceAuthority: "UK HM Revenue & Customs",
    scope: "country", coverage: "standard-rate-only",
    components: [{ id: "GB-VAT-STANDARD", name: "VAT", rateBps: 2000, source: "https://www.gov.uk/vat-rates" }],
  }),
  AE: freezeRule({
    id: "AE-VAT-STANDARD-2026-11", version: "2026.11",
    countryCode: "AE", currencyCode: "AED", taxName: "VAT",
    treatment: "standard", rateBps: 500,
    effectiveFrom: "2018-01-01", effectiveTo: null,
    reviewedOn: "2026-11-14",
    source: "https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/",
    sourceAuthority: "UAE Ministry of Finance",
    scope: "country", coverage: "standard-rate-only",
    components: [{ id: "AE-VAT-STANDARD", name: "VAT", rateBps: 500, source: "https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/" }],
  }),
  AU: freezeRule({
    id: "AU-GST-STANDARD-2026-11", version: "2026.11",
    countryCode: "AU", currencyCode: "AUD", taxName: "GST",
    treatment: "standard", rateBps: 1000,
    effectiveFrom: "2000-07-01", effectiveTo: null,
    reviewedOn: "2026-11-14",
    source: "https://www.ato.gov.au/Business/GST/",
    sourceAuthority: "Australian Taxation Office",
    scope: "country", coverage: "standard-rate-only",
    components: [{ id: "AU-GST-STANDARD", name: "GST", rateBps: 1000, source: "https://www.ato.gov.au/Business/GST/" }],
  }),
  SG: freezeRule({
    id: "SG-GST-STANDARD-2026-11", version: "2026.11",
    countryCode: "SG", currencyCode: "SGD", taxName: "GST",
    treatment: "standard", rateBps: 900,
    effectiveFrom: "2024-01-01", effectiveTo: null,
    reviewedOn: "2026-11-14",
    source: "https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/current-gst-rates",
    sourceAuthority: "Singapore Inland Revenue Authority",
    scope: "country", coverage: "standard-rate-only",
    components: [{ id: "SG-GST-STANDARD", name: "GST", rateBps: 900, source: "https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/current-gst-rates" }],
  }),
});

const validDate = (value) => {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const copyRule = (rule) => ({
  ...rule,
  components: rule.components.map((component) => ({ ...component })),
});

export function normalizeTaxCountryCode(value) {
  return typeof value === "string" && /^[A-Za-z]{2}$/.test(value.trim())
    ? value.trim().toUpperCase()
    : null;
}

export function listTaxCountryProfiles() {
  return Object.values(COUNTRY_PROFILES).map((profile) => ({ ...profile }));
}

export function getTaxCountryProfile(countryCode) {
  const code = normalizeTaxCountryCode(countryCode);
  const profile = code ? COUNTRY_PROFILES[code] : null;
  return profile ? { ...profile } : null;
}

/**
 * Resolve one country rule by invoice date. This never guesses a jurisdiction
 * rate and never treats country selection as evidence of tax registration.
 */
export function getTaxRuleSet(countryCode, options = {}) {
  const code = normalizeTaxCountryCode(countryCode);
  if (!code) return { ok: false, status: "invalid_country", code: "INVALID_COUNTRY_CODE", catalogVersion: TAX_RULE_CATALOG_VERSION };
  const profile = COUNTRY_PROFILES[code];
  if (!profile) return { ok: false, status: "unsupported_country", code: "COUNTRY_TAX_NOT_CONFIGURED", countryCode: code, catalogVersion: TAX_RULE_CATALOG_VERSION };
  if (profile.ruleMode === "india_legacy") {
    return { ok: false, status: "india_legacy", code: "INDIA_LEGACY_ADAPTER_REQUIRED", countryCode: code, profile: { ...profile }, catalogVersion: TAX_RULE_CATALOG_VERSION };
  }
  if (profile.ruleMode === "jurisdiction_required") {
    return { ok: false, status: "jurisdiction_required", code: "JURISDICTION_RULE_REQUIRED", countryCode: code, profile: { ...profile }, catalogVersion: TAX_RULE_CATALOG_VERSION };
  }

  const asOfDate = options.asOfDate;
  if (asOfDate !== undefined && !validDate(asOfDate)) {
    return { ok: false, status: "invalid_date", code: "INVALID_RULE_AS_OF_DATE", countryCode: code, catalogVersion: TAX_RULE_CATALOG_VERSION };
  }
  const rule = RULES[code];
  if (!rule) return { ok: false, status: "rule_unavailable", code: "TAX_RULE_UNAVAILABLE", countryCode: code, catalogVersion: TAX_RULE_CATALOG_VERSION };
  if (asOfDate && (asOfDate < rule.effectiveFrom || (rule.effectiveTo && asOfDate > rule.effectiveTo))) {
    return { ok: false, status: "no_effective_rule", code: "NO_EFFECTIVE_TAX_RULE", countryCode: code, ruleId: rule.id, catalogVersion: TAX_RULE_CATALOG_VERSION };
  }
  return {
    ok: true, status: "rule_available", countryCode: code,
    catalogVersion: TAX_RULE_CATALOG_VERSION,
    profile: { ...profile },
    rule: copyRule(rule),
  };
}

export function listTaxRuleSets() {
  return Object.values(RULES).map(copyRule);
}
