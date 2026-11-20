import test from "node:test";
import assert from "node:assert/strict";
import { calculateVerifiedTaxRule } from "../tax/verified-rule-evaluator.js";
const base = {
  countryCode: "GB", currencyCode: "GBP", currencyMinorUnits: 2, amountMinor: 10000,
  invoiceDate: "2026-11-16", sellerRegistration: {
    verified: true, status: "registered", registrationNumber: "GB123456789", effectiveFrom: "2026-01-01",
  },
  placeOfSupplyVerified: true, placeOfSupply: "GB", taxCategoryVerified: true,
  taxCategory: "standard-rated", treatment: "standard", priceMode: "exclusive",
  rule: {
    id: "GB-STD", version: "1", countryCode: "GB", currencyCode: "GBP", treatment: "standard",
    verified: true, effectiveFrom: "2026-01-01", reviewedOn: "2026-11-16", reviewedBy: "Plivex tax review", source: "https://www.gov.uk/vat-rates",
    components: [{ id: "VAT", rateBps: 2000, source: "https://www.gov.uk/vat-rates" }],
  },
};
test("calculates inclusive and exclusive tax in integer minor units", () => {
  const exclusive = calculateVerifiedTaxRule(base);
  assert.equal(exclusive.ok, true); assert.equal(exclusive.taxMinor, 2000); assert.equal(exclusive.totalMinor, 12000);
  const inclusive = calculateVerifiedTaxRule({ ...base, priceMode: "inclusive" });
  assert.equal(inclusive.ok, true); assert.equal(inclusive.taxableMinor, 8333); assert.equal(inclusive.taxMinor, 1667);
});
test("fails closed for invalid currency, unsupported treatment and expired registration", () => {
  assert.equal(calculateVerifiedTaxRule({ ...base, currencyCode: "USD" }).code, "CURRENCY_MISMATCH");
  assert.equal(calculateVerifiedTaxRule({ ...base, treatment: "exempt" }).code, "TREATMENT_RULE_REQUIRED");
  assert.equal(calculateVerifiedTaxRule({ ...base, sellerRegistration: { ...base.sellerRegistration, effectiveTo: "2026-01-31" } }).code, "REGISTRATION_NOT_EFFECTIVE");
});
test("rejects unofficial rule source and safely rejects total overflow", () => {
  assert.equal(calculateVerifiedTaxRule({ ...base, rule: { ...base.rule, source: "https://example.com" } }).code, "INVALID_OR_INACTIVE_RULE");
  assert.equal(calculateVerifiedTaxRule({ ...base, amountMinor: Number.MAX_SAFE_INTEGER }).code, "AMOUNT_OUT_OF_RANGE");
});

test("rejects a rule marked verified without reviewer and review date", () => {
  const { reviewedOn, reviewedBy, ...unreviewed } = base.rule;
  assert.equal(calculateVerifiedTaxRule({ ...base, rule: unreviewed }).code, "INVALID_OR_INACTIVE_RULE");
  assert.equal(calculateVerifiedTaxRule({ ...base, rule: { ...base.rule, reviewedOn: "2026-11-17" } }).ok, true);
});
test("rejects malformed effective-date ranges", () => {
  assert.equal(calculateVerifiedTaxRule({ ...base, rule: { ...base.rule, effectiveTo: "2025-12-31" } }).code, "INVALID_OR_INACTIVE_RULE");
});
