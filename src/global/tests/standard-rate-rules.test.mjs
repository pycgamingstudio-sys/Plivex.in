import test from "node:test";
import assert from "node:assert/strict";
import { getCountryStandardRateRule } from "../tax/standard-rate-rules.js";
import { calculateVerifiedTaxRule } from "../tax/verified-rule-evaluator.js";

test("only documented standard-rate baselines are supplied for GB, AE, AU and SG", () => {
  assert.deepEqual(
    ["GB", "AE", "AU", "SG"].map((code) => getCountryStandardRateRule(code).rateBps),
    [2000, 500, 1000, 900],
  );
  for (const code of ["IN", "US", "CA", "XX"]) assert.equal(getCountryStandardRateRule(code), null);
});

test("baseline rule snapshots carry official source, version and review date", () => {
  for (const code of ["GB", "AE", "AU", "SG"]) {
    const rule = getCountryStandardRateRule(code);
    assert.equal(rule.verified, true);
    assert.equal(rule.components.length, 1);
    assert.match(rule.source, /^https:\/\//);
    assert.equal(rule.reviewedOn, "2026-11-14");
    assert.equal(rule.effectiveTo, null);
    assert.equal(rule.coverage, "standard-rate-only");
  }
});

test("standard baseline is usable only with explicit verified seller and supply facts", () => {
  const rule = getCountryStandardRateRule("SG");
  const result = calculateVerifiedTaxRule({
    countryCode: "SG", currencyCode: "SGD", currencyMinorUnits: 2, amountMinor: 10000,
    invoiceDate: "2026-11-14",
    sellerRegistration: {
      verified: true, status: "registered", registrationNumber: "M12345678A",
      effectiveFrom: "2026-01-01",
    },
    placeOfSupplyVerified: true, placeOfSupply: "SG",
    taxCategoryVerified: true, taxCategory: "standard-rated",
    treatment: "standard", priceMode: "exclusive", rule,
  });
  assert.equal(result.ok, true);
  assert.equal(result.taxMinor, 900);
  assert.equal(result.totalMinor, 10900);
});

test("legal effective dates are separate from the rule review date", () => {
  const expected = { GB: "2011-01-04", AE: "2018-01-01", AU: "2000-07-01", SG: "2024-01-01" };
  for (const [country, effectiveFrom] of Object.entries(expected)) {
    const rule = getCountryStandardRateRule(country);
    assert.equal(rule.effectiveFrom, effectiveFrom);
    assert.equal(rule.reviewedOn, "2026-11-14");
    assert.notEqual(rule.effectiveFrom, rule.reviewedOn);
  }
});

test("historical invoice dates before each legal effective date are rejected", () => {
  const cases = [["GB", "2011-01-03"], ["AE", "2017-12-31"], ["AU", "2000-06-30"], ["SG", "2023-12-31"]];
  for (const [countryCode, invoiceDate] of cases) {
    const rule = getCountryStandardRateRule(countryCode);
    const result = calculateVerifiedTaxRule({
      countryCode, currencyCode: rule.currencyCode, currencyMinorUnits: 2, amountMinor: 10000,
      invoiceDate, sellerRegistration: { verified: false, attestedByUser: true, status: "registered", registrationNumber: "REG", effectiveFrom: "1990-01-01" },
      placeOfSupplyVerified: true, placeOfSupply: countryCode, taxCategoryVerified: true,
      taxCategory: "standard-rated", treatment: "standard", priceMode: "exclusive", rule,
    });
    assert.equal(result.ok, false, countryCode);
    assert.equal(result.code, "INVALID_OR_INACTIVE_RULE", countryCode);
  }
});
