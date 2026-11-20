import test from "node:test";
import assert from "node:assert/strict";
import { calculateGlobalTax } from "../tax/global-tax-engine.js";
import { getTaxTreatmentRuleSet } from "../tax/tax-rule-registry.js";

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
  assert.equal(calculateGlobalTax({ ...base, countryCode: "CA", currencyCode: "CAD", treatment: "standard" }).code, "JURISDICTION_RULE_REQUIRED");
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
