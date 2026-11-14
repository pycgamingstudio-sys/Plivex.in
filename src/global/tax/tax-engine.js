/**
 * Plivex Global Tax Engine — deterministic indirect-tax calculator.
 *
 * This is deliberately fail-closed. Country identity is not tax registration,
 * nexus, place-of-supply, product classification, or legal taxability.
 * Rules below are verified STANDARD-RATE baselines only; they are not a
 * complete country tax determination. US/CA and India require jurisdiction/
 * legacy adapters and are never guessed here.
 */

export const TAX_ENGINE_VERSION = "0.1.0";
export const TAX_RULES_REVIEWED_ON = "2026-11-14";

const STANDARD_RULES = Object.freeze({
  GB: Object.freeze({
    taxName: "VAT", rateBps: 2000, currency: "GBP",
    source: "https://www.gov.uk/vat-rates",
    sourceTitle: "UK Government — VAT rates",
  }),
  AE: Object.freeze({
    taxName: "VAT", rateBps: 500, currency: "AED",
    source: "https://mof.gov.ae/en/public-finance/tax/value-added-tax-vat/",
    sourceTitle: "UAE Ministry of Finance — VAT",
  }),
  AU: Object.freeze({
    taxName: "GST", rateBps: 1000, currency: "AUD",
    source: "https://www.ato.gov.au/Business/GST/",
    sourceTitle: "Australian Taxation Office — GST",
  }),
  SG: Object.freeze({
    taxName: "GST", rateBps: 900, currency: "SGD",
    source: "https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/current-gst-rates",
    sourceTitle: "IRAS — Current GST rates",
  }),
});

const CURRENCY_MINOR_UNITS = Object.freeze({
  INR: 2, USD: 2, GBP: 2, AED: 2, CAD: 2, AUD: 2, SGD: 2,
});

const fail = (code, message) => ({ ok: false, status: "needs_review", code, message });
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const roundDiv = (numerator, denominator) => Math.floor((numerator + Math.floor(denominator / 2)) / denominator);

function validateProvenance(rule) {
  return isRecord(rule)
    && typeof rule.id === "string" && rule.id.trim().length > 0
    && typeof rule.version === "string" && rule.version.trim().length > 0
    && typeof rule.source === "string" && /^https:\/\//.test(rule.source)
    && typeof rule.effectiveFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rule.effectiveFrom)
    && Number.isInteger(rule.rateBps) && rule.rateBps >= 0 && rule.rateBps <= 10000;
}

/**
 * Returns only the known standard-rate baseline. Caller must still prove
 * registration, effective date, place of supply and standard-rated category.
 */
export function getStandardRateBaseline(countryCode) {
  const code = String(countryCode || "").trim().toUpperCase();
  const rule = STANDARD_RULES[code];
  if (!rule) return null;
  return {
    id: `${code}-STANDARD-${TAX_RULES_REVIEWED_ON}`,
    version: TAX_ENGINE_VERSION,
    countryCode: code,
    taxName: rule.taxName,
    currencyCode: rule.currency,
    rateBps: rule.rateBps,
    treatment: "standard",
    effectiveFrom: ({ GB: "2011-01-04", AE: "2018-01-01", AU: "2000-07-01", SG: "2024-01-01" })[code],
    effectiveTo: null,
    source: rule.source,
    sourceTitle: rule.sourceTitle,
    reviewedOn: TAX_RULES_REVIEWED_ON,
    coverage: "standard-rate-baseline-only",
  };
}

/**
 * Calculate a single tax component in integer minor units.
 *
 * Required facts are intentionally explicit. US, CA and IN are routed to
 * their dedicated adapters; this generic calculator will not infer them.
 */
export function calculateTax(input) {
  if (!isRecord(input)) return fail("INVALID_INPUT", "Tax calculation input is required.");
  const countryCode = String(input.countryCode || "").trim().toUpperCase();
  const currencyCode = String(input.currencyCode || "").trim().toUpperCase();

  if (!["IN", "US", "GB", "AE", "CA", "AU", "SG"].includes(countryCode)) {
    return fail("UNSUPPORTED_COUNTRY", "This country is not enabled in the current tax engine.");
  }
  if (["IN", "US", "CA"].includes(countryCode)) {
    return fail("JURISDICTION_ADAPTER_REQUIRED", "This country requires its dedicated GST or jurisdiction adapter; no generic rate will be guessed.");
  }
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) {
    return fail("INVALID_AMOUNT", "Amount must be a non-negative integer in currency minor units.");
  }
  if (CURRENCY_MINOR_UNITS[currencyCode] === undefined) {
    return fail("INVALID_CURRENCY", "Currency is not supported by the current currency precision map.");
  }
  const baseline = getStandardRateBaseline(countryCode);
  if (currencyCode !== baseline.currencyCode) {
    return fail("CURRENCY_MISMATCH", "Transaction currency does not match this country's baseline currency. FX conversion is not performed.");
  }
  if (input.currencyMinorUnits !== CURRENCY_MINOR_UNITS[currencyCode]) {
    return fail("CURRENCY_PRECISION_REQUIRED", "Explicit currency minor-unit precision is required.");
  }
  if (input.sellerRegistration?.verified !== true
    || input.sellerRegistration?.status !== "registered"
    || typeof input.sellerRegistration?.registrationNumber !== "string"
    || !input.sellerRegistration.registrationNumber.trim()
    || typeof input.sellerRegistration.effectiveFrom !== "string") {
    return fail("REGISTRATION_UNVERIFIED", "Verified seller tax registration and effective date are required before charging tax.");
  }
  if (typeof input.invoiceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate)
    || input.invoiceDate < input.sellerRegistration.effectiveFrom) {
    return fail("REGISTRATION_NOT_EFFECTIVE", "Invoice date is invalid or precedes the seller's tax registration effective date.");
  }
  if (input.placeOfSupplyVerified !== true || !input.placeOfSupply) {
    return fail("PLACE_OF_SUPPLY_REQUIRED", "Verified place-of-supply information is required.");
  }
  if (input.taxCategoryVerified !== true || !input.taxCategory) {
    return fail("TAX_CATEGORY_REQUIRED", "A verified goods/services tax category is required.");
  }
  if (input.treatment !== "standard") {
    return fail("TREATMENT_RULE_REQUIRED", "Zero-rated, reduced, exempt, reverse-charge and out-of-scope treatments require a separately verified rule.");
  }
  const rule = input.rule || baseline;
  if (!validateProvenance(rule) || rule.countryCode !== countryCode
    || rule.currencyCode !== currencyCode || rule.treatment !== "standard") {
    return fail("INVALID_TAX_RULE", "A versioned, country-matched tax rule with official source provenance is required.");
  }
  if (input.invoiceDate < rule.effectiveFrom
    || (rule.effectiveTo && input.invoiceDate > rule.effectiveTo)) {
    return fail("RULE_NOT_EFFECTIVE", "The selected tax rule is not effective on the invoice date.");
  }
  if (rule.coverage !== "standard-rate-baseline-only" && rule.verified !== true) {
    return fail("RULE_NOT_VERIFIED", "The selected tax rule has not been marked as verified.");
  }
  if (!["exclusive", "inclusive"].includes(input.priceMode)) {
    return fail("PRICE_MODE_REQUIRED", "Choose whether the entered amount includes tax or excludes tax.");
  }

  const rateBps = rule.rateBps;
  const amount = input.amountMinor;
  let taxableMinor;
  let taxMinor;
  let totalMinor;
  if (input.priceMode === "exclusive") {
    taxableMinor = amount;
    taxMinor = roundDiv(amount * rateBps, 10000);
    totalMinor = taxableMinor + taxMinor;
  } else {
    totalMinor = amount;
    taxableMinor = roundDiv(amount * 10000, 10000 + rateBps);
    taxMinor = totalMinor - taxableMinor;
  }

  return {
    ok: true,
    status: "calculated",
    engineVersion: TAX_ENGINE_VERSION,
    countryCode,
    currencyCode,
    currencyMinorUnits: CURRENCY_MINOR_UNITS[currencyCode],
    treatment: "standard",
    taxName: rule.taxName || baseline.taxName,
    priceMode: input.priceMode,
    taxableMinor,
    taxMinor,
    totalMinor,
    components: [{
      id: rule.id,
      name: rule.taxName || baseline.taxName,
      rateBps,
      amountMinor: taxMinor,
    }],
    ruleSnapshot: {
      id: rule.id,
      version: rule.version,
      source: rule.source,
      sourceTitle: rule.sourceTitle || "",
      effectiveFrom: rule.effectiveFrom,
      reviewedOn: rule.reviewedOn || null,
    },
  };
}

/** Format only; does not convert currencies or alter stored amounts. */
export function formatTaxMoney(amountMinor, currencyCode, locale) {
  const code = String(currencyCode || "").toUpperCase();
  const precision = CURRENCY_MINOR_UNITS[code];
  if (!Number.isInteger(amountMinor) || precision === undefined || typeof locale !== "string") {
    throw new Error("Valid minor-unit amount, currency and locale are required.");
  }
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: code,
    minimumFractionDigits: precision, maximumFractionDigits: precision,
  }).format(amountMinor / (10 ** precision));
}
