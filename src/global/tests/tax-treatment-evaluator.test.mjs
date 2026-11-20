import test from "node:test";
import assert from "node:assert/strict";
import { calculateGlobalTax } from "../tax/global-tax-engine.js";
import { getTaxTreatmentRuleSet, getTaxRuleSet } from "../tax/tax-rule-registry.js";

const base = {
  countryCode: "GB", currencyCode: "GBP", currencyMinorUnits: 2, amountMinor: 10000,
  invoiceDate: "2026-11-14",
  sellerRegistration: {
    verified: true, status: "registered", registrationNumber: "GB123456789",
    effectiveFrom: "2026-01-01",
  },
  placeOfSupplyVerified: true, placeOfSupply: "GB",
  taxCategoryVerified: true, taxCategory: "confirmed-supply-category",
  priceMode: "exclusive",
};

const makeRule = (treatment, rateBps) => ({
  id: `GB-VAT-${treatment.toUpperCase()}-TEST`,
  version: "test-1",
  countryCode: "GB",
  currencyCode: "GBP",
  treatment,
  taxCategoryId: "confirmed-supply-category",
  verified: true,
  reviewedBy: "Independent rule review",
  reviewedOn: "2026-11-01",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  source: "https://www.gov.uk/vat-rates",
  components: [{
    id: `GB-VAT-${treatment}`,
    name: "VAT",
    rateBps,
    source: "https://www.gov.uk/vat-rates",
  }],
});

test("verified reduced-rate rules calculate using their own versioned component rate", () => {
  const result = calculateGlobalTax({
    ...base, treatment: "reduced", rule: makeRule("reduced", 500),
  });
  assert.equal(result.ok, true);
  assert.equal(result.taxMinor, 500);
  assert.equal(result.totalMinor, 10500);
  assert.equal(result.treatment, "reduced");
  assert.equal(result.ruleSnapshot.treatment, "reduced");
});

test("zero-rated, exempt and out-of-scope treatments remain distinct and charge zero tax", () => {
  for (const treatment of ["zero-rated", "exempt", "out-of-scope"]) {
    const result = calculateGlobalTax({
      ...base, treatment, rule: makeRule(treatment, 0),
    });
    assert.equal(result.ok, true, treatment);
    assert.equal(result.taxMinor, 0, treatment);
    assert.equal(result.totalMinor, 10000, treatment);
    assert.equal(result.taxCharged, false, treatment);
    assert.match(result.taxDisclosure, new RegExp(treatment === "zero-rated" ? "Zero-rated" : treatment === "exempt" ? "Exempt" : "Outside the scope"));
  }
});

test("a zero rate cannot be mislabeled as standard or reduced and vice versa", () => {
  const zeroAsStandard = calculateGlobalTax({
    ...base, treatment: "standard", rule: makeRule("standard", 0),
  });
  const positiveAsExempt = calculateGlobalTax({
    ...base, treatment: "exempt", rule: makeRule("exempt", 500),
  });
  assert.equal(zeroAsStandard.code, "TREATMENT_RATE_MISMATCH");
  assert.equal(positiveAsExempt.code, "TREATMENT_RATE_MISMATCH");
});

test("non-standard treatments require an exact product/service tax category match", () => {
  const missingCategory = calculateGlobalTax({
    ...base, treatment: "reduced", rule: { ...makeRule("reduced", 500), taxCategoryId: "food-only" },
  });
  assert.equal(missingCategory.code, "TREATMENT_CATEGORY_RULE_REQUIRED");
});

test("treatment must match the verified rule and unsupported reverse charge fails closed", () => {
  const mismatch = calculateGlobalTax({
    ...base, treatment: "reduced", rule: makeRule("standard", 2000),
  });
  const reverseCharge = calculateGlobalTax({
    ...base, treatment: "reverse-charge", rule: makeRule("reverse-charge", 0),
  });
  assert.equal(mismatch.code, "TREATMENT_RULE_MISMATCH");
  assert.equal(reverseCharge.code, "TREATMENT_ADAPTER_REQUIRED");
});

test("US and Canada still require exact jurisdiction rules; no national rate is added", () => {
  assert.equal(calculateGlobalTax({ ...base, countryCode: "US", currencyCode: "USD", treatment: "standard" }).code, "JURISDICTION_RULE_REQUIRED");
  assert.equal(calculateGlobalTax({ ...base, countryCode: "CA", currencyCode: "CAD", treatment: "standard" }).code, "CANADIAN_PROVINCE_REQUIRED");
});

test("UK domestic fuel and power reduced-rate rule is available only for its exact confirmed category", () => {
  const category = "GB_REDUCED_DOMESTIC_FUEL_POWER";
  const resolved = getTaxTreatmentRuleSet("GB", { treatment: "reduced", taxCategoryId: category, asOfDate: "2026-11-20" });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.rule.components[0].rateBps, 500);
  const result = calculateGlobalTax({ ...base, invoiceDate: "2026-11-20", treatment: "reduced", taxCategory: category });
  assert.equal(result.ok, true);
  assert.equal(result.taxMinor, 500);
  assert.equal(result.totalMinor, 10500);
  const wrongCategory = calculateGlobalTax({ ...base, treatment: "reduced", taxCategory: "GB_STANDARD_GOODS" });
  assert.equal(wrongCategory.code, "NO_EFFECTIVE_VERIFIED_RULE");
  const wrongDate = getTaxTreatmentRuleSet("GB", { treatment: "reduced", taxCategoryId: category, asOfDate: "2010-12-31" });
  assert.equal(wrongDate.code, "NO_EFFECTIVE_VERIFIED_RULE");
});


test("UAE, Australia and Singapore expose narrowly scoped verified special treatments", () => {
  const cases = [
    ["AE", "zero-rated", "AE_ZERO_RATED_EXPORTS"],
    ["AE", "exempt", "AE_EXEMPT_FINANCIAL_SERVICES"],
    ["AU", "gst-free", "AU_GST_FREE_BASIC_FOOD"],
    ["AU", "exempt", "AU_INPUT_TAXED_FINANCIAL_SERVICES"],
    ["SG", "zero-rated", "SG_ZERO_RATED_EXPORTS_INTERNATIONAL_SERVICES"],
    ["SG", "exempt", "SG_EXEMPT_FINANCIAL_SERVICES"],
    ["SG", "out-of-scope", "SG_OUT_OF_SCOPE_OVERSEAS_TO_OVERSEAS_GOODS"],
    ["CA", "zero-rated", "CA_ZERO_RATED_BASIC_GROCERIES"],
  ];
  for (const [countryCode, treatment, taxCategoryId] of cases) {
    const resolved = getTaxTreatmentRuleSet(countryCode, { treatment, taxCategoryId, ...(countryCode === "CA" ? { jurisdictionId: "QC" } : {}), asOfDate: "2026-11-20" });
    assert.equal(resolved.ok, true, taxCategoryId);
    assert.equal(resolved.rule.components[0].rateBps, 0, taxCategoryId);
  }
  assert.equal(getTaxTreatmentRuleSet("AE", { treatment: "zero-rated", taxCategoryId: "wrong-category", asOfDate: "2026-11-20" }).ok, false);
});

test("Canada standard tax resolves GST/HST plus general PST/QST by province or territory", () => {
  const expected = { AB: 500, BC: 1200, MB: 1200, NB: 1500, NL: 1500, NS: 1400, NT: 500, NU: 500, ON: 1300, PE: 1500, QC: 1497.5, SK: 1100, YT: 500 };
  for (const [jurisdictionId, rateBps] of Object.entries(expected)) {
    const result = getTaxRuleSet("CA", { jurisdictionId, asOfDate: "2026-11-20" });
    assert.equal(result.ok, true, jurisdictionId);
    assert.equal(result.rule.rateBps, rateBps, jurisdictionId);
    assert.equal(result.rule.jurisdictionId, jurisdictionId);
    assert.match(result.rule.coverage, /general-provincial-sales-tax-baselines/);
    assert.ok(result.rule.components.every((component) => component.source.startsWith("https://")));
  }
  assert.equal(getTaxRuleSet("CA", { asOfDate: "2026-11-20" }).code, "CANADIAN_PROVINCE_REQUIRED");
  const zeroRated = getTaxTreatmentRuleSet("CA", { treatment: "zero-rated", taxCategoryId: "CA_ZERO_RATED_BASIC_GROCERIES", jurisdictionId: "QC", asOfDate: "2026-11-20" });
  assert.equal(zeroRated.ok, true);
  assert.equal(zeroRated.rule.jurisdictionId, "QC");
  assert.equal(zeroRated.rule.components[0].rateBps, 0);
});


test("expanded official country tax categories resolve only for their exact treatment and category", () => {
  const cases = [
    ["GB", "zero-rated", "GB_ZERO_RATED_BOOKS_PRINTED_MATTER"],
    ["GB", "zero-rated", "GB_ZERO_RATED_CHILDRENS_CLOTHING"],
    ["GB", "exempt", "GB_EXEMPT_ELIGIBLE_BODY_EDUCATION"],
    ["CA", "zero-rated", "CA_ZERO_RATED_EXPORTS"],
    ["CA", "exempt", "CA_EXEMPT_FINANCIAL_SERVICES"],
    ["AE", "zero-rated", "AE_ZERO_RATED_QUALIFYING_HEALTHCARE"],
    ["AE", "zero-rated", "AE_ZERO_RATED_QUALIFYING_EDUCATION"],
    ["SG", "exempt", "SG_EXEMPT_RESIDENTIAL_PROPERTY"],
    ["SG", "exempt", "SG_EXEMPT_INVESTMENT_PRECIOUS_METALS"],
  ];
  for (const [countryCode, treatment, taxCategoryId] of cases) {
    const resolved = getTaxTreatmentRuleSet(countryCode, {
      treatment, taxCategoryId, asOfDate: "2026-11-20",
    });
    assert.equal(resolved.ok, true, taxCategoryId);
    assert.equal(resolved.rule.countryCode, countryCode);
    assert.equal(resolved.rule.treatment, treatment);
    assert.equal(resolved.rule.components.reduce((sum, item) => sum + item.rateBps, 0), 0);
    assert.ok(resolved.rule.source.startsWith("https://"));
  }
});


test("verified UK and UAE reverse-charge rules resolve only for their explicit categories", () => {
  const cases = [
    ["GB", "GB_REVERSE_CHARGE_CONSTRUCTION_STANDARD", 2000],
    ["GB", "GB_REVERSE_CHARGE_CONSTRUCTION_REDUCED", 500],
    ["AE", "AE_REVERSE_CHARGE_ELECTRONIC_DEVICES", 500],
  ];
  for (const [countryCode, taxCategoryId, rateBps] of cases) {
    const resolved = getTaxTreatmentRuleSet(countryCode, {
      treatment: "reverse-charge", taxCategoryId, asOfDate: "2026-11-20",
    });
    assert.equal(resolved.ok, true, taxCategoryId);
    assert.equal(resolved.rule.treatment, "reverse-charge");
    assert.equal(resolved.rule.components[0].rateBps, rateBps);
  }
  assert.equal(getTaxTreatmentRuleSet("US", {
    treatment: "reverse-charge", taxCategoryId: "US_REVERSE_CHARGE_NOT_APPLICABLE",
    asOfDate: "2026-11-20",
  }).ok, false);
});
