import test from "node:test";
import assert from "node:assert/strict";
import { calculateGlobalTaxWithRegistry } from "../tax/global-tax-engine.js";

const rule = {
  id: "GB-VAT-STD-2026-11", version: "2026.11", countryCode: "GB", currencyCode: "GBP",
  treatment: "standard", verified: true, effectiveFrom: "2026-01-01", effectiveTo: null,
  reviewedOn: "2026-11-14", reviewedBy: "compliance-review-fixture",
  source: "https://www.gov.uk/vat-rates", components: [{ id: "VAT", name: "VAT", rateBps: 2000 }],
};
const base = {
  countryCode: "GB", currencyCode: "GBP", currencyMinorUnits: 2, amountMinor: 10000,
  invoiceDate: "2026-11-16", sellerRegistration: {
    verified: true, status: "registered", registrationNumber: "GB123456789", effectiveFrom: "2026-01-01",
  },
  placeOfSupplyVerified: true, placeOfSupply: "GB", taxCategoryVerified: true,
  taxCategory: "standard-rated", treatment: "standard", priceMode: "exclusive",
};

test("Global tax engine resolves the exact verified rule and returns its immutable snapshot", () => {
  const result = calculateGlobalTaxWithRegistry(base, [rule]);
  assert.equal(result.ok, true);
  assert.equal(result.taxMinor, 2000);
  assert.equal(result.ruleSnapshot.id, rule.id);
  assert.equal(result.ruleSnapshot.version, rule.version);
});
test("registry calculation fails closed for missing, ambiguous and inactive rules", () => {
  assert.equal(calculateGlobalTaxWithRegistry(base, []).code, "NO_EFFECTIVE_VERIFIED_RULE");
  assert.equal(calculateGlobalTaxWithRegistry(base, [rule, rule]).code, "AMBIGUOUS_EFFECTIVE_RULE");
  assert.equal(calculateGlobalTaxWithRegistry({ ...base, invoiceDate: "2025-12-31" }, [rule]).code, "NO_EFFECTIVE_VERIFIED_RULE");
});
