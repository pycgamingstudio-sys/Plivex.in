// Bundled copy for the save-invoice Edge Function. Keep in sync with src/global/tax/verified-rule-evaluator.js.
import { getCurrencyPrecision } from "../money/currency-precision.js";
import { TAX_ENGINE_VERSION, TAX_RULE_CATALOG_VERSION } from "./tax-rule-registry.js";

/**
 * Verified, componentized tax-rule evaluator for Global jurisdictions.
 * All arithmetic is integer-only. No guessed US/Canada rates or FX conversion.
 */
const COUNTRIES = Object.freeze({ IN: "INR", US: "USD", GB: "GBP", AE: "AED", CA: "CAD", AU: "AUD", SG: "SGD" });
const OFFICIAL_SOURCE_HOSTS = Object.freeze({
  US: ["gov"], GB: ["gov.uk"], AE: ["tax.gov.ae", "mof.gov.ae"],
  CA: ["canada.ca", "revenuquebec.ca", "gouv.qc.ca"],
  AU: ["ato.gov.au"], SG: ["iras.gov.sg"],
});
const officialSource = (countryCode, value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return (OFFICIAL_SOURCE_HOSTS[countryCode] || []).some((suffix) =>
      host === suffix || host.endsWith("." + suffix));
  } catch { return false; }
};
const fail = (code, message) => ({ ok: false, status: "needs_review", code, message });
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
};
const roundHalfUp = (numerator, denominator) => (numerator + denominator / 2n) / denominator;
const safeNumber = (value) => value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
  ? Number(value) : null;

/**
 * Evaluate a verified rule snapshot. US/CA additionally require exact
 * destination jurisdiction and an explicit business-confirmed obligation.
 */
export function calculateVerifiedTaxRule(input) {
  if (!record(input)) return fail("INVALID_INPUT", "Tax calculation input is required.");
  const countryCode = String(input.countryCode || "").toUpperCase();
  const currencyCode = String(input.currencyCode || "").toUpperCase();
  const expectedCurrency = COUNTRIES[countryCode];
  if (!expectedCurrency) return fail("UNSUPPORTED_COUNTRY", "Country is not enabled.");
  if (countryCode === "IN") return fail("INDIA_LEGACY_ADAPTER_REQUIRED", "India must use the existing GST invoice path.");
  if (currencyCode !== expectedCurrency) return fail("CURRENCY_MISMATCH", "Currency does not match the selected country; FX conversion is not performed.");
  const precision = getCurrencyPrecision(currencyCode);
  if (precision === null || precision !== input.currencyMinorUnits) return fail("CURRENCY_PRECISION_REQUIRED", "Explicit supported currency precision is required.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) return fail("INVALID_AMOUNT", "Amount must be a non-negative safe integer in minor units.");

  const registration = input.sellerRegistration;
  if (!record(registration) || (registration.verified !== true && registration.attestedByUser !== true)
    || registration.status !== "registered" || typeof registration.registrationNumber !== "string"
    || !registration.registrationNumber.trim() || !validDate(registration.effectiveFrom)) {
    return fail("REGISTRATION_UNVERIFIED", "Registered seller details and an explicit business confirmation are required; Plivex does not independently verify registration.");
  }
  if (!validDate(input.invoiceDate) || input.invoiceDate < registration.effectiveFrom
    || (registration.effectiveTo && (!validDate(registration.effectiveTo) || input.invoiceDate > registration.effectiveTo))) {
    return fail("REGISTRATION_NOT_EFFECTIVE", "Invoice date is invalid or outside the confirmed registration period.");
  }
  if (input.placeOfSupplyVerified !== true || !input.placeOfSupply) return fail("PLACE_OF_SUPPLY_REQUIRED", "A confirmed place of supply is required.");
  if (input.taxCategoryVerified !== true || !input.taxCategory) return fail("TAX_CATEGORY_REQUIRED", "A confirmed goods/services tax category is required.");
  if (input.treatment !== "standard") return fail("TREATMENT_RULE_REQUIRED", "Non-standard treatments need a separately verified rule.");
  if (!["exclusive", "inclusive"].includes(input.priceMode)) return fail("PRICE_MODE_REQUIRED", "Price mode must be inclusive or exclusive.");

  const rule = input.rule;
  if (!record(rule) || rule.verified !== true || rule.countryCode !== countryCode
    || rule.currencyCode !== currencyCode || rule.treatment !== "standard"
    || typeof rule.id !== "string" || !rule.id.trim() || typeof rule.version !== "string" || !rule.version.trim()
    || !officialSource(countryCode, rule.source) || !validDate(rule.effectiveFrom)
    || (rule.effectiveTo && (!validDate(rule.effectiveTo) || rule.effectiveTo < rule.effectiveFrom))
    || !validDate(rule.reviewedOn) || rule.reviewedOn > input.invoiceDate
    || typeof rule.reviewedBy !== "string" || !rule.reviewedBy.trim()
    || input.invoiceDate < rule.effectiveFrom || (rule.effectiveTo && input.invoiceDate > rule.effectiveTo)) {
    return fail("INVALID_OR_INACTIVE_RULE", "A verified, officially sourced, reviewed and effective rule snapshot is required.");
  }
  if (!Array.isArray(rule.components) || rule.components.length < 1 || rule.components.length > 8) {
    return fail("INVALID_TAX_COMPONENTS", "One to eight explicit tax components are required.");
  }

  const ids = new Set();
  for (const component of rule.components) {
    if (!record(component) || typeof component.id !== "string" || !component.id.trim()
      || ids.has(component.id) || !Number.isInteger(component.rateBps) || component.rateBps < 0
      || component.rateBps > 10000 || !officialSource(countryCode, component.source || rule.source)) {
      return fail("INVALID_TAX_COMPONENT", "Each component needs a unique ID, valid rate and official source.");
    }
    ids.add(component.id);
  }

  const jurisdictional = countryCode === "US" || countryCode === "CA";
  const jurisdictionEvidence = input.jurisdictionVerified === true ? "independently-verified"
    : input.jurisdictionAttestedByUser === true ? "user-attested" : null;
  const collectionEvidence = input.collectionObligationVerified === true ? "independently-verified"
    : input.collectionObligationAttestedByUser === true ? "user-attested" : null;
  if (jurisdictional && (typeof rule.jurisdictionId !== "string" || !rule.jurisdictionId.trim()
    || input.jurisdictionId !== rule.jurisdictionId || !jurisdictionEvidence || !collectionEvidence)) {
    return fail("JURISDICTION_OR_NEXUS_REQUIRED", "US/Canada require an exact destination jurisdiction and an explicit collection-obligation confirmation. User attestations are recorded as such and are not independent verification.");
  }

  const rateBps = rule.components.reduce((sum, component) => sum + component.rateBps, 0);
  if (rateBps > 10000) return fail("RATE_OR_AMOUNT_OUT_OF_RANGE", "Combined tax rate exceeds supported limits.");
  const amount = BigInt(input.amountMinor);
  const rate = BigInt(rateBps);
  const basis = 10000n;
  const taxable = input.priceMode === "exclusive" ? amount : roundHalfUp(amount * basis, basis + rate);
  const total = input.priceMode === "exclusive" ? amount + roundHalfUp(amount * rate, basis) : amount;
  const tax = total - taxable;
  const taxableMinor = safeNumber(taxable), totalMinor = safeNumber(total), taxMinor = safeNumber(tax);
  if ([taxableMinor, totalMinor, taxMinor].some((value) => value === null)) {
    return fail("AMOUNT_OUT_OF_RANGE", "Calculated totals exceed safe integer limits.");
  }

  const components = rule.components.map((component) => ({
    id: component.id, name: component.name || component.id, rateBps: component.rateBps,
    amountMinor: safeNumber(roundHalfUp(taxable * BigInt(component.rateBps), basis)),
    source: component.source || rule.source,
  }));
  if (components.some((component) => component.amountMinor === null)) return fail("AMOUNT_OUT_OF_RANGE", "Tax component exceeds safe integer limits.");
  const componentTotal = components.reduce((sum, component) => sum + component.amountMinor, 0);
  components[components.length - 1].amountMinor += taxMinor - componentTotal;

  return {
    ok: true, status: "calculated", engineVersion: TAX_ENGINE_VERSION, countryCode, currencyCode,
    currencyMinorUnits: precision, jurisdictionId: rule.jurisdictionId || null,
    treatment: rule.treatment, priceMode: input.priceMode, taxableMinor, taxMinor, totalMinor, components,
    registrationEvidence: registration.verified === true ? "externally-verified" : "user-attested",
    jurisdictionEvidence: jurisdictional ? jurisdictionEvidence : null,
    collectionObligationEvidence: jurisdictional ? collectionEvidence : null,
    ruleSnapshot: {
      id: rule.id, version: rule.version, catalogVersion: rule.catalogVersion || TAX_RULE_CATALOG_VERSION,
      source: rule.source, sourceAuthority: rule.sourceAuthority || null, coverage: rule.coverage || null,
      effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo || null, reviewedOn: rule.reviewedOn || null,
    },
  };
}
