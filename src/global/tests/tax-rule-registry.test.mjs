import test from "node:test";
import assert from "node:assert/strict";
import { resolveTaxRuleSnapshot, validateTaxRuleSnapshot } from "../tax/tax-rule-registry.js";
const rule = {
  id: "GB-VAT-STD-2026", version: "2026.1", countryCode: "GB", currencyCode: "GBP",
  treatment: "standard", verified: true, effectiveFrom: "2026-01-01", effectiveTo: null,
  reviewedOn: "2026-10-01", reviewedBy: "compliance-review-fixture",
  source: "https://www.gov.uk/vat-rates", components: [{ id: "VAT", rateBps: 2000 }],
};
test("validates a verified official-source rule snapshot", () => { assert.equal(validateTaxRuleSnapshot(rule).ok, true); });
test("rejects invalid dates, unverified source domains and excessive rates", () => {
  assert.equal(validateTaxRuleSnapshot({ ...rule, effectiveFrom: "2026-02-30" }).code, "INVALID_EFFECTIVE_DATES");
  assert.equal(validateTaxRuleSnapshot({ ...rule, components: [{ id: "VAT", rateBps: 10001 }] }).code, "INVALID_COMPONENT");
  assert.equal(validateTaxRuleSnapshot({ ...rule, source: "https://example.com" }).code, "SOURCE_OR_REVIEW_REQUIRED");
  assert.equal(validateTaxRuleSnapshot({ ...rule, components: [{ id: "A", rateBps: 6000 }, { id: "B", rateBps: 5000 }] }).code, "COMBINED_RATE_EXCEEDS_LIMIT");
});
test("resolves exactly one rule active on invoice date", () => {
  assert.equal(resolveTaxRuleSnapshot([rule], { countryCode: "GB", invoiceDate: "2026-10-01", treatment: "standard" }).ok, true);
  assert.equal(resolveTaxRuleSnapshot([rule], { countryCode: "GB", invoiceDate: "2025-12-31", treatment: "standard" }).code, "NO_EFFECTIVE_VERIFIED_RULE");
  assert.equal(resolveTaxRuleSnapshot([rule, rule], { countryCode: "GB", invoiceDate: "2026-10-01", treatment: "standard" }).code, "AMBIGUOUS_EFFECTIVE_RULE");
});
