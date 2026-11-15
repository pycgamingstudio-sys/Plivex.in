/**
 * Verified, componentized tax-rule evaluator for Global jurisdictions.
 * It accepts maintained rule snapshots; it contains no guessed US/Canada rates.
 * All financial values are integer currency minor units. No FX conversion.
 */
const CURRENCY_MINOR_UNITS = Object.freeze({ INR: 2, USD: 2, GBP: 2, AED: 2, CAD: 2, AUD: 2, SGD: 2 });
const COUNTRIES = Object.freeze({ IN: "INR", US: "USD", GB: "GBP", AE: "AED", CA: "CAD", AU: "AUD", SG: "SGD" });
const OFFICIAL_SOURCE_HOSTS = Object.freeze({
  US: ["gov", "us"],
  GB: ["gov.uk"],
  AE: ["gov.ae"],
  CA: ["canada.ca", "revenuquebec.ca", "gouv.qc.ca"],
  AU: ["ato.gov.au"],
  SG: ["iras.gov.sg"],
});
const officialSource = (countryCode, value) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (OFFICIAL_SOURCE_HOSTS[countryCode] || []).some((suffix) =>
      suffix === "gov" || suffix === "us"
        ? host.endsWith("." + suffix) || host === suffix
        : host === suffix || host.endsWith("." + suffix)
    );
  } catch { return false; }
};
const fail = (code, message) => ({ ok: false, status: "needs_review", code, message });
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
};
const roundDiv = (n, d) => Math.floor((n + Math.floor(d / 2)) / d);

/**
 * Evaluate an explicitly verified rule snapshot with multiple components.
 * US/CA additionally require a verified destination jurisdiction and seller
 * collection obligation. India remains on its existing GST path.
 */
export function calculateVerifiedTaxRule(input) {
  if (!record(input)) return fail("INVALID_INPUT", "Tax calculation input is required.");
  const countryCode = String(input.countryCode || "").toUpperCase();
  const currencyCode = String(input.currencyCode || "").toUpperCase();
  const expectedCurrency = COUNTRIES[countryCode];
  if (!expectedCurrency) return fail("UNSUPPORTED_COUNTRY", "Country is not enabled.");
  if (countryCode === "IN") return fail("INDIA_LEGACY_ADAPTER_REQUIRED", "India must use the existing GST invoice path.");
  if (currencyCode !== expectedCurrency) return fail("CURRENCY_MISMATCH", "Currency does not match the selected country; FX conversion is not performed.");
  if (CURRENCY_MINOR_UNITS[currencyCode] !== input.currencyMinorUnits) return fail("CURRENCY_PRECISION_REQUIRED", "Explicit currency precision is required.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) return fail("INVALID_AMOUNT", "Amount must be a non-negative safe integer in minor units.");

  const registration = input.sellerRegistration;
  if (!record(registration) || (registration.verified !== true && registration.attestedByUser !== true) || registration.status !== "registered"
    || typeof registration.registrationNumber !== "string" || !registration.registrationNumber.trim()
    || !validDate(registration.effectiveFrom)) {
    return fail("REGISTRATION_UNVERIFIED", "Registered seller details and an explicit business confirmation are required; Plivex does not independently verify registration.");
  }
  if (!validDate(input.invoiceDate) || input.invoiceDate < registration.effectiveFrom) return fail("REGISTRATION_NOT_EFFECTIVE", "Invoice date is invalid or before registration effective date.");
  if (input.placeOfSupplyVerified !== true || !input.placeOfSupply) return fail("PLACE_OF_SUPPLY_REQUIRED", "A confirmed place of supply is required.");
  if (input.taxCategoryVerified !== true || !input.taxCategory) return fail("TAX_CATEGORY_REQUIRED", "A confirmed goods/services tax category is required.");
  if (input.treatment !== "standard") return fail("TREATMENT_RULE_REQUIRED", "Non-standard treatments need a separately verified rule.");
  if (!["exclusive", "inclusive"].includes(input.priceMode)) return fail("PRICE_MODE_REQUIRED", "Price mode must be inclusive or exclusive.");

  const rule = input.rule;
  if (!record(rule) || rule.verified !== true || rule.countryCode !== countryCode
    || rule.currencyCode !== currencyCode || rule.treatment !== "standard"
    || typeof rule.id !== "string" || !rule.id.trim()
    || typeof rule.version !== "string" || !rule.version.trim()
    || typeof rule.source !== "string" || !/^https:\/\//.test(rule.source)
    || !validDate(rule.effectiveFrom) || (rule.effectiveTo && !validDate(rule.effectiveTo))
    || input.invoiceDate < rule.effectiveFrom || (rule.effectiveTo && input.invoiceDate > rule.effectiveTo)) {
    return fail("INVALID_OR_INACTIVE_RULE", "A verified, sourced, effective rule snapshot is required.");
  }
  if (!Array.isArray(rule.components) || rule.components.length < 1 || rule.components.length > 8) return fail("INVALID_TAX_COMPONENTS", "One to eight explicit tax components are required.");

  const ids = new Set();
  for (const component of rule.components) {
    if (!record(component) || typeof component.id !== "string" || !component.id.trim()
      || ids.has(component.id) || !Number.isInteger(component.rateBps) || component.rateBps < 0 || component.rateBps > 10000
      || typeof (component.source || rule.source) !== "string" || !officialSource(countryCode, component.source || rule.source)) {
      return fail("INVALID_TAX_COMPONENT", "Each component needs a unique ID, valid rate and official source.");
    }
    ids.add(component.id);
  }

  const jurisdictional = countryCode === "US" || countryCode === "CA";
  if (jurisdictional && (typeof rule.jurisdictionId !== "string" || !rule.jurisdictionId.trim()
    || input.jurisdictionVerified !== true || input.jurisdictionId !== rule.jurisdictionId
    || input.collectionObligationVerified !== true)) {
    return fail("JURISDICTION_OR_NEXUS_REQUIRED", "US/Canada require independently verified destination jurisdiction and collection-obligation evidence; matching seller registration region is not proof of nexus.");
  }

  const rateBps = rule.components.reduce((sum, component) => sum + component.rateBps, 0);
  if (rateBps > 10000 || !Number.isSafeInteger(input.amountMinor * rateBps)
    || !Number.isSafeInteger(input.amountMinor * 10000)) return fail("RATE_OR_AMOUNT_OUT_OF_RANGE", "Combined rate or amount exceeds supported limits.");
  const amount = input.amountMinor;
  const taxableMinor = input.priceMode === "exclusive" ? amount : roundDiv(amount * 10000, 10000 + rateBps);
  const totalMinor = input.priceMode === "exclusive" ? amount + roundDiv(amount * rateBps, 10000) : amount;
  const taxMinor = totalMinor - taxableMinor;
  if (![taxableMinor, totalMinor, taxMinor].every(Number.isSafeInteger)) return fail("AMOUNT_OUT_OF_RANGE", "Calculated totals exceed safe integer limits.");

  const components = rule.components.map((component) => ({
    id: component.id, name: component.name || component.id, rateBps: component.rateBps,
    amountMinor: roundDiv(taxableMinor * component.rateBps, 10000), source: component.source || rule.source,
  }));
  const componentTotal = components.reduce((sum, component) => sum + component.amountMinor, 0);
  components[components.length - 1].amountMinor += taxMinor - componentTotal;

  return {
    ok: true, status: "calculated", engineVersion: "0.1.0", countryCode, currencyCode,
    currencyMinorUnits: CURRENCY_MINOR_UNITS[currencyCode], jurisdictionId: rule.jurisdictionId || null,
    treatment: rule.treatment, priceMode: input.priceMode, taxableMinor, taxMinor, totalMinor, components,
    registrationEvidence: registration.verified === true ? "externally-verified" : "user-attested",
    ruleSnapshot: {
      id: rule.id, version: rule.version, source: rule.source,
      effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo || null, reviewedOn: rule.reviewedOn || null,
    },
  };
}
