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
export const TAX_RULE_CATALOG_VERSION = "2026.11.4";
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
    ruleMode: "standard_rate_baseline", issuance: "standard_rate_only",
    coverage: "standard-and-narrow-reduced-rate-baseline",
    note: "Standard VAT plus one narrowly scoped reduced-rate category for domestic fuel or power; other special treatments are not covered.",
  }),
  AE: Object.freeze({
    countryCode: "AE", taxSystem: "VAT", currencyCode: "AED",
    ruleMode: "standard_rate_baseline", issuance: "standard_rate_only",
    coverage: "standard-and-narrow-special-treatment-baselines",
    note: "Standard VAT plus narrowly scoped export zero-rating and exempt-category rules; designated-zone, reverse-charge and other special cases remain unsupported.",
  }),
  CA: Object.freeze({
    countryCode: "CA", taxSystem: "GST/HST/PST/QST", currencyCode: "CAD",
    ruleMode: "jurisdiction_required", issuance: "standard_rate_only",
    coverage: "province-territory-jurisdiction-required",
    note: "No single Canada-wide combined rate is assumed. Province/territory and place-of-supply rules must be resolved independently.",
  }),
  AU: Object.freeze({
    countryCode: "AU", taxSystem: "GST", currencyCode: "AUD",
    ruleMode: "standard_rate_baseline", issuance: "standard_rate_only",
    coverage: "standard-and-narrow-special-treatment-baselines",
    note: "Standard GST plus narrowly scoped GST-free and input-taxed categories; other special cases remain unsupported.",
  }),
  SG: Object.freeze({
    countryCode: "SG", taxSystem: "GST", currencyCode: "SGD",
    ruleMode: "standard_rate_baseline", issuance: "standard_rate_only",
    coverage: "standard-and-narrow-special-treatment-baselines",
    note: "Standard GST plus narrowly scoped zero-rated, exempt and out-of-scope categories; reverse-charge and special schemes remain unsupported.",
  }),
});

const CA_PROVINCE_RULES = Object.freeze({
  AB: { name: "Alberta", components: [{ id: "CA-AB-GST", name: "GST", rateBps: 500 }] },
  BC: { name: "British Columbia", components: [{ id: "CA-BC-GST", name: "GST", rateBps: 500 }, { id: "CA-BC-PST", name: "PST", rateBps: 700 }] },
  MB: { name: "Manitoba", components: [{ id: "CA-MB-GST", name: "GST", rateBps: 500 }, { id: "CA-MB-RST", name: "RST", rateBps: 700 }] },
  NB: { name: "New Brunswick", components: [{ id: "CA-NB-HST", name: "HST", rateBps: 1500 }] },
  NL: { name: "Newfoundland and Labrador", components: [{ id: "CA-NL-HST", name: "HST", rateBps: 1500 }] },
  NS: { name: "Nova Scotia", components: [{ id: "CA-NS-HST", name: "HST", rateBps: 1400 }] },
  NT: { name: "Northwest Territories", components: [{ id: "CA-NT-GST", name: "GST", rateBps: 500 }] },
  NU: { name: "Nunavut", components: [{ id: "CA-NU-GST", name: "GST", rateBps: 500 }] },
  ON: { name: "Ontario", components: [{ id: "CA-ON-HST", name: "HST", rateBps: 1300 }] },
  PE: { name: "Prince Edward Island", components: [{ id: "CA-PE-HST", name: "HST", rateBps: 1500 }] },
  SK: { name: "Saskatchewan", components: [{ id: "CA-SK-GST", name: "GST", rateBps: 500 }, { id: "CA-SK-PST", name: "PST", rateBps: 600 }] },
  QC: { name: "Quebec", components: [{ id: "CA-QC-GST", name: "GST", rateBps: 500 }, { id: "CA-QC-QST", name: "QST", rateBps: 997.5 }] },
  YT: { name: "Yukon", components: [{ id: "CA-YT-GST", name: "GST", rateBps: 500 }] },
});
const CA_RATE_SOURCE = "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html";

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


const TREATMENT_RULES = Object.freeze([
  freezeRule({
    id: "CA-GST-ZERO-RATED-BASIC-GROCERIES-2026-11", version: "2026.11",
    countryCode: "CA", currencyCode: "CAD", taxName: "GST/HST",
    treatment: "zero-rated", taxCategoryId: "CA_ZERO_RATED_BASIC_GROCERIES",
    rateBps: 0, verified: true, reviewedBy: "Plivex tax rule review",
    effectiveFrom: "1991-01-01", effectiveTo: null, reviewedOn: "2026-11-20",
    source: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html",
    sourceAuthority: "Canada Revenue Agency", scope: "country", coverage: "basic-groceries-zero-rated-across-canada-only",
    components: [{ id: "CA-GST-HST-ZERO", name: "GST/HST", rateBps: 0, source: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html" }],
  }),
  freezeRule({
    id: "AE-VAT-ZERO-RATED-EXPORTS-2026-11", version: "2026.11",
    countryCode: "AE", currencyCode: "AED", taxName: "VAT",
    treatment: "zero-rated", taxCategoryId: "AE_ZERO_RATED_EXPORTS",
    rateBps: 0, verified: true, reviewedBy: "Plivex tax rule review",
    effectiveFrom: "2018-01-01", effectiveTo: null, reviewedOn: "2026-11-20",
    source: "https://tax.gov.ae/en/faq.aspx?keyword=What+sectors+will+be+zero+rated%3F",
    sourceAuthority: "UAE Federal Tax Authority",
    scope: "country", coverage: "export-of-goods-and-services-outside-gcc-only",
    components: [{ id: "AE-VAT-ZERO", name: "VAT", rateBps: 0, source: "https://tax.gov.ae/en/faq.aspx?keyword=What+sectors+will+be+zero+rated%3F" }],
  }),
  freezeRule({
    id: "AE-VAT-EXEMPT-FINANCIAL-SERVICES-2026-11", version: "2026.11",
    countryCode: "AE", currencyCode: "AED", taxName: "VAT",
    treatment: "exempt", taxCategoryId: "AE_EXEMPT_FINANCIAL_SERVICES",
    rateBps: 0, verified: true, reviewedBy: "Plivex tax rule review",
    effectiveFrom: "2018-01-01", effectiveTo: null, reviewedOn: "2026-11-20",
    source: "https://tax.gov.ae/en/faq.aspx?keyword=exempt",
    sourceAuthority: "UAE Federal Tax Authority",
    scope: "country", coverage: "financial-services-exemption-category-only",
    components: [{ id: "AE-VAT-EXEMPT", name: "VAT", rateBps: 0, source: "https://tax.gov.ae/en/faq.aspx?keyword=exempt" }],
  }),
  freezeRule({
    id: "AU-GST-FREE-BASIC-FOOD-2026-11", version: "2026.11",
    countryCode: "AU", currencyCode: "AUD", taxName: "GST",
    treatment: "gst-free", taxCategoryId: "AU_GST_FREE_BASIC_FOOD",
    rateBps: 0, verified: true, reviewedBy: "Plivex tax rule review",
    effectiveFrom: "2000-07-01", effectiveTo: null, reviewedOn: "2026-11-20",
    source: "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/when-to-charge-gst-and-when-not-to/gst-free-sales",
    sourceAuthority: "Australian Taxation Office",
    scope: "country", coverage: "basic-food-gst-free-category-only",
    components: [{ id: "AU-GST-FREE", name: "GST", rateBps: 0, source: "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/when-to-charge-gst-and-when-not-to/gst-free-sales" }],
  }),
  freezeRule({
    id: "AU-GST-INPUT-TAXED-FINANCIAL-SERVICES-2026-11", version: "2026.11",
    countryCode: "AU", currencyCode: "AUD", taxName: "GST",
    treatment: "exempt", taxCategoryId: "AU_INPUT_TAXED_FINANCIAL_SERVICES",
    rateBps: 0, verified: true, reviewedBy: "Plivex tax rule review",
    effectiveFrom: "2000-07-01", effectiveTo: null, reviewedOn: "2026-11-20",
    source: "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/when-to-charge-gst-and-when-not-to/input-taxed-sales",
    sourceAuthority: "Australian Taxation Office",
    scope: "country", coverage: "input-taxed-financial-services-category-only",
    components: [{ id: "AU-GST-INPUT-TAXED", name: "GST", rateBps: 0, source: "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/when-to-charge-gst-and-when-not-to/input-taxed-sales" }],
  }),
  freezeRule({
    id: "SG-GST-ZERO-RATED-EXPORTS-2026-11", version: "2026.11",
    countryCode: "SG", currencyCode: "SGD", taxName: "GST",
    treatment: "zero-rated", taxCategoryId: "SG_ZERO_RATED_EXPORTS_INTERNATIONAL_SERVICES",
    rateBps: 0, verified: true, reviewedBy: "Plivex tax rule review",
    effectiveFrom: "1994-04-01", effectiveTo: null, reviewedOn: "2026-11-20",
    source: "https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/charging-gst-%28output-tax%29/when-to-charge-goods-and-services-tax-%28gst%29",
    sourceAuthority: "Singapore Inland Revenue Authority",
    scope: "country", coverage: "exports-of-goods-and-qualifying-international-services-only",
    components: [{ id: "SG-GST-ZERO", name: "GST", rateBps: 0, source: "https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/charging-gst-%28output-tax%29/when-to-charge-goods-and-services-tax-%28gst%29" }],
  }),
  freezeRule({
    id: "SG-GST-EXEMPT-FINANCIAL-SERVICES-2026-11", version: "2026.11",
    countryCode: "SG", currencyCode: "SGD", taxName: "GST",
    treatment: "exempt", taxCategoryId: "SG_EXEMPT_FINANCIAL_SERVICES",
    rateBps: 0, verified: true, reviewedBy: "Plivex tax rule review",
    effectiveFrom: "1994-04-01", effectiveTo: null, reviewedOn: "2026-11-20",
    source: "https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/charging-gst-%28output-tax%29/when-is-gst-not-charged/supplies-exempt-from-gst",
    sourceAuthority: "Singapore Inland Revenue Authority",
    scope: "country", coverage: "exempt-financial-services-category-only",
    components: [{ id: "SG-GST-EXEMPT", name: "GST", rateBps: 0, source: "https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/charging-gst-%28output-tax%29/when-is-gst-not-charged/supplies-exempt-from-gst" }],
  }),
  freezeRule({
    id: "SG-GST-OUT-OF-SCOPE-OVERSEAS-GOODS-2026-11", version: "2026.11",
    countryCode: "SG", currencyCode: "SGD", taxName: "GST",
    treatment: "out-of-scope", taxCategoryId: "SG_OUT_OF_SCOPE_OVERSEAS_TO_OVERSEAS_GOODS",
    rateBps: 0, verified: true, reviewedBy: "Plivex tax rule review",
    effectiveFrom: "1994-04-01", effectiveTo: null, reviewedOn: "2026-11-20",
    source: "https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/goods-and-services-tax-%28gst%29-what-it-is-and-how-it-works",
    sourceAuthority: "Singapore Inland Revenue Authority",
    scope: "country", coverage: "goods-delivered-from-overseas-to-overseas-only",
    components: [{ id: "SG-GST-OUT-OF-SCOPE", name: "GST", rateBps: 0, source: "https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/goods-and-services-tax-%28gst%29-what-it-is-and-how-it-works" }],
  }),
  freezeRule({
    id: "GB-VAT-REDUCED-DOMESTIC-FUEL-POWER-2026-11", version: "2026.11",
    countryCode: "GB", currencyCode: "GBP", taxName: "VAT",
    treatment: "reduced", taxCategoryId: "GB_REDUCED_DOMESTIC_FUEL_POWER",
    rateBps: 500, verified: true, reviewedBy: "Plivex tax rule review",
    effectiveFrom: "2011-01-04", effectiveTo: null,
    reviewedOn: "2026-11-20",
    source: "https://www.gov.uk/charge-reclaim-record-vat",
    sourceAuthority: "UK HM Revenue & Customs",
    scope: "country", coverage: "reduced-rate-domestic-fuel-power-only",
    components: [{ id: "GB-VAT-REDUCED-DOMESTIC-FUEL-POWER", name: "VAT", rateBps: 500, source: "https://www.gov.uk/charge-reclaim-record-vat" }],
  }),
]);

const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
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
  if (profile.ruleMode === "jurisdiction_required" && code !== "CA") {
    return { ok: false, status: "jurisdiction_required", code: "JURISDICTION_RULE_REQUIRED", countryCode: code, profile: { ...profile }, catalogVersion: TAX_RULE_CATALOG_VERSION };
  }
  if (code === "CA") {
    const province = typeof options.jurisdictionId === "string" ? options.jurisdictionId.trim().toUpperCase() : "";
    const entry = CA_PROVINCE_RULES[province];
    if (!entry) return { ok: false, status: "jurisdiction_required", code: "CANADIAN_PROVINCE_REQUIRED", countryCode: code, profile: { ...profile }, catalogVersion: TAX_RULE_CATALOG_VERSION };
    const asOfDate = options.asOfDate;
    if (asOfDate !== undefined && !validDate(asOfDate)) return { ok: false, status: "invalid_date", code: "INVALID_RULE_AS_OF_DATE", countryCode: code, catalogVersion: TAX_RULE_CATALOG_VERSION };
    if (asOfDate && asOfDate < "2025-04-01" && province === "NS") {
      return { ok: false, status: "no_effective_rule", code: "HISTORIC_NOVA_SCOTIA_RATE_REQUIRES_TRANSITION_REVIEW", countryCode: code, catalogVersion: TAX_RULE_CATALOG_VERSION };
    }
    const components = entry.components.map((component) => ({ ...component, source: CA_RATE_SOURCE }));
    const rateBps = components.reduce((sum, component) => sum + component.rateBps, 0);
    const rule = {
      id: `CA-${province}-GST-HST-PST-2025-04`, version: "2025.04",
      countryCode: "CA", currencyCode: "CAD", taxName: components.map((component) => component.name).join(" + "),
      treatment: "standard", jurisdictionId: province, rateBps,
      effectiveFrom: province === "NS" ? "2025-04-01" : "2025-04-01", effectiveTo: null,
      reviewedOn: "2026-11-20", source: CA_RATE_SOURCE, sourceAuthority: "Canada Revenue Agency",
      scope: "province", coverage: ["BC", "MB", "SK"].includes(province) ? "federal-gst-hst-plus-listed-provincial-pst-rst-components" : province === "QC" ? "federal-gst-plus-quebec-qst" : "federal-gst-or-harmonized-hst-only",
      components,
    };
    return { ok: true, status: "rule_available", countryCode: code, catalogVersion: TAX_RULE_CATALOG_VERSION, profile: { ...profile }, rule };
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


/**
 * Resolve only an explicitly requested, category-matched non-standard rule.
 * No category inference or fallback to the standard rate is performed.
 */
export function getTaxTreatmentRuleSet(countryCode, { treatment, taxCategoryId, asOfDate, jurisdictionId } = {}) {
  const code = normalizeTaxCountryCode(countryCode);
  if (!code || !["reduced", "zero-rated", "gst-free", "exempt", "out-of-scope"].includes(treatment)
    || typeof taxCategoryId !== "string" || !taxCategoryId.trim()) {
    return { ok: false, status: "invalid_treatment_rule_request", code: "TREATMENT_AND_CATEGORY_REQUIRED", catalogVersion: TAX_RULE_CATALOG_VERSION };
  }
  if (asOfDate !== undefined && !validDate(asOfDate)) {
    return { ok: false, status: "invalid_date", code: "INVALID_RULE_AS_OF_DATE", countryCode: code, catalogVersion: TAX_RULE_CATALOG_VERSION };
  }
  const matches = TREATMENT_RULES.filter((rule) => rule.countryCode === code
    && rule.treatment === treatment && rule.taxCategoryId === taxCategoryId
    && (!asOfDate || (asOfDate >= rule.effectiveFrom && (!rule.effectiveTo || asOfDate <= rule.effectiveTo))));
  if (matches.length !== 1) {
    return { ok: false, status: "rule_unavailable", code: matches.length ? "AMBIGUOUS_TREATMENT_RULE" : "NO_EFFECTIVE_VERIFIED_RULE", countryCode: code, catalogVersion: TAX_RULE_CATALOG_VERSION };
  }
  const rule = copyRule(matches[0]);
  if (code === "CA") {
    const province = typeof jurisdictionId === "string" ? jurisdictionId.trim().toUpperCase() : "";
    if (!Object.hasOwn(CA_PROVINCE_RULES, province)) {
      return { ok: false, status: "jurisdiction_required", code: "CANADIAN_PROVINCE_REQUIRED", countryCode: code, catalogVersion: TAX_RULE_CATALOG_VERSION };
    }
    rule.jurisdictionId = province;
  }
  return { ok: true, status: "rule_available", countryCode: code, catalogVersion: TAX_RULE_CATALOG_VERSION, rule };
}

export function listTaxRuleSets() {
  return Object.values(RULES).map(copyRule);
}



const SNAPSHOT_COUNTRY_CURRENCY = Object.freeze({ IN: "INR", US: "USD", GB: "GBP", AE: "AED", CA: "CAD", AU: "AUD", SG: "SGD" });
const SNAPSHOT_OFFICIAL_HOSTS = Object.freeze({
  IN: ["cbic-gst.gov.in", "gst.gov.in"], US: ["gov"], GB: ["gov.uk"],
  AE: ["tax.gov.ae", "mof.gov.ae"], CA: ["canada.ca", "revenuquebec.ca", "gouv.qc.ca"],
  AU: ["ato.gov.au"], SG: ["iras.gov.sg"],
});
const snapshotValidDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};
const snapshotIsRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function snapshotOfficialSource(country, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    return (SNAPSHOT_OFFICIAL_HOSTS[country] || []).some((host) => url.hostname === host || url.hostname.endsWith("." + host));
  } catch { return false; }
}
export function validateTaxRuleSnapshot(rule) {
  if (!snapshotIsRecord(rule)) return { ok: false, code: "INVALID_RULE" };
  if (typeof rule.id !== "string" || !rule.id.trim() || typeof rule.version !== "string" || !rule.version.trim()) return { ok: false, code: "RULE_ID_VERSION_REQUIRED" };
  if (!/^[A-Z]{2}$/.test(rule.countryCode || "") || !/^[A-Z]{3}$/.test(rule.currencyCode || "")
    || !Object.hasOwn(SNAPSHOT_COUNTRY_CURRENCY, rule.countryCode) || SNAPSHOT_COUNTRY_CURRENCY[rule.countryCode] !== rule.currencyCode) return { ok: false, code: "INVALID_COUNTRY_CURRENCY" };
  if (!["standard", "reduced", "zero-rated", "exempt", "reverse-charge", "out-of-scope"].includes(rule.treatment)) return { ok: false, code: "INVALID_TREATMENT" };
  if (!snapshotValidDate(rule.effectiveFrom) || (rule.effectiveTo !== null && rule.effectiveTo !== undefined
    && (!snapshotValidDate(rule.effectiveTo) || rule.effectiveTo < rule.effectiveFrom))) return { ok: false, code: "INVALID_EFFECTIVE_DATES" };
  if (!snapshotValidDate(rule.reviewedOn) || !snapshotOfficialSource(rule.countryCode, rule.source)
    || typeof rule.reviewedBy !== "string" || !rule.reviewedBy.trim()) return { ok: false, code: "SOURCE_OR_REVIEW_REQUIRED" };
  if ((rule.countryCode === "US" || rule.countryCode === "CA")
    && (typeof rule.jurisdictionId !== "string" || !rule.jurisdictionId.trim())) return { ok: false, code: "JURISDICTION_REQUIRED" };
  if (rule.verified !== true || !Array.isArray(rule.components) || rule.components.length < 1 || rule.components.length > 8) return { ok: false, code: "UNVERIFIED_RULE" };
  const ids = new Set();
  let combinedRate = 0;
  for (const component of rule.components) {
    if (!snapshotIsRecord(component) || typeof component.id !== "string" || !component.id.trim() || ids.has(component.id)
      || !Number.isFinite(component.rateBps) || !Number.isInteger(component.rateBps * 10) || component.rateBps < 0 || component.rateBps > 10000
      || (component.source && !snapshotOfficialSource(rule.countryCode, component.source))) return { ok: false, code: "INVALID_COMPONENT" };
    ids.add(component.id);
    combinedRate += component.rateBps;
  }
  if (combinedRate > 10000) return { ok: false, code: "COMBINED_RATE_EXCEEDS_LIMIT" };
  return { ok: true, rule: Object.freeze({ ...rule, components: Object.freeze(rule.components.map((c) => Object.freeze({ ...c }))) }) };
}
export function resolveTaxRuleSnapshot(rules, { countryCode, jurisdictionId = null, invoiceDate, treatment }) {
  if (!Array.isArray(rules) || !snapshotValidDate(invoiceDate)) return { ok: false, code: "INVALID_RESOLUTION_INPUT" };
  const country = String(countryCode || "").toUpperCase();
  if (!Object.hasOwn(SNAPSHOT_COUNTRY_CURRENCY, country)) return { ok: false, code: "UNSUPPORTED_COUNTRY" };
  if ((country === "US" || country === "CA") && (typeof jurisdictionId !== "string" || !jurisdictionId.trim())) {
    return { ok: false, code: "JURISDICTION_REQUIRED" };
  }
  const candidates = [];
  for (const raw of rules) {
    const checked = validateTaxRuleSnapshot(raw);
    if (!checked.ok) continue;
    const rule = checked.rule;
    if (rule.countryCode !== country || rule.treatment !== treatment
      || (rule.jurisdictionId || null) !== (jurisdictionId || null)) continue;
    if (invoiceDate < rule.effectiveFrom || (rule.effectiveTo && invoiceDate > rule.effectiveTo)) continue;
    candidates.push(rule);
  }
  if (candidates.length === 0) return { ok: false, code: "NO_EFFECTIVE_VERIFIED_RULE" };
  if (candidates.length !== 1) return { ok: false, code: "AMBIGUOUS_EFFECTIVE_RULE" };
  return { ok: true, rule: candidates[0] };
}
