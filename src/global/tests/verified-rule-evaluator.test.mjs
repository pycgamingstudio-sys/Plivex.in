import test from "node:test";
import assert from "node:assert/strict";
import { calculateVerifiedTaxRule } from "../tax/verified-rule-evaluator.js";

const rule = {
  id: "CA-ON-2026-01", version: "2026.1", countryCode: "CA", currencyCode: "CAD",
  treatment: "standard", verified: true, jurisdictionId: "CA-ON",
  effectiveFrom: "2026-01-01", reviewedOn: "2026-11-14", source: "https://www.canada.ca/en/revenue-agency.html",
  components: [
    { id: "GST", name: "GST", rateBps: 500 },
    { id: "PST", name: "PST", rateBps: 800 },
  ],
};
const base = {
  countryCode: "CA", currencyCode: "CAD", currencyMinorUnits: 2, amountMinor: 10000,
  invoiceDate: "2026-11-14", sellerRegistration: {
    verified: true, status: "registered", registrationNumber: "CA-REG-123",
    effectiveFrom: "2026-01-01", jurisdictions: ["CA-ON"],
  },
  placeOfSupplyVerified: true, placeOfSupply: "Ontario",
  taxCategoryVerified: true, taxCategory: "taxable-goods", treatment: "standard",
  priceMode: "exclusive", jurisdictionVerified: true, jurisdictionId: "CA-ON",
  collectionObligationVerified: true, rule,
};

test("Canada componentized GST/PST sums and reconciles component totals", () => {
  const result = calculateVerifiedTaxRule(base);
  assert.equal(result.ok, true);
  assert.equal(result.taxableMinor, 10000);
  assert.equal(result.taxMinor, 1300);
  assert.equal(result.totalMinor, 11300);
  assert.deepEqual(result.components.map((c) => c.amountMinor), [500, 800]);
  assert.equal(result.ruleSnapshot.id, "CA-ON-2026-01");
});

test("US and Canada fail closed without independent jurisdiction and collection-obligation evidence", () => {
  assert.equal(calculateVerifiedTaxRule({ ...base, jurisdictionVerified: false }).code, "JURISDICTION_OR_NEXUS_REQUIRED");
  assert.equal(calculateVerifiedTaxRule({ ...base, collectionObligationVerified: false }).code, "JURISDICTION_OR_NEXUS_REQUIRED");
  assert.equal(calculateVerifiedTaxRule({ ...base, sellerRegistration: { ...base.sellerRegistration, jurisdictions: [] } }).ok, true);
});

test("rule rejects duplicate components, bad source and invalid rates", () => {
  assert.equal(calculateVerifiedTaxRule({ ...base, rule: { ...rule, components: [rule.components[0], rule.components[0]] } }).code, "INVALID_TAX_COMPONENT");
  assert.equal(calculateVerifiedTaxRule({ ...base, rule: { ...rule, components: [{ ...rule.components[0], rateBps: 10001 }] } }).code, "INVALID_TAX_COMPONENT");
  assert.equal(calculateVerifiedTaxRule({ ...base, rule: { ...rule, source: "http://untrusted.example" } }).code, "INVALID_OR_INACTIVE_RULE");
});

test("inclusive price uses combined component rate and preserves entered total", () => {
  const result = calculateVerifiedTaxRule({ ...base, priceMode: "inclusive", amountMinor: 11300 });
  assert.equal(result.ok, true);
  assert.equal(result.totalMinor, 11300);
  assert.equal(result.taxableMinor, 10000);
  assert.equal(result.taxMinor, 1300);
});

test("effective dates, registration, currency and India legacy path are enforced", () => {
  assert.equal(calculateVerifiedTaxRule({ ...base, invoiceDate: "2025-12-31" }).code, "REGISTRATION_NOT_EFFECTIVE");
  assert.equal(calculateVerifiedTaxRule({ ...base, invoiceDate: "2026-02-30" }).code, "REGISTRATION_NOT_EFFECTIVE");
  assert.equal(calculateVerifiedTaxRule({ ...base, currencyCode: "USD" }).code, "CURRENCY_MISMATCH");
  assert.equal(calculateVerifiedTaxRule({ ...base, countryCode: "IN", currencyCode: "INR" }).code, "INDIA_LEGACY_ADAPTER_REQUIRED");
});

test("component tax rounding reconciles to the total tax exactly", () => {
  const result = calculateVerifiedTaxRule({
    ...base, amountMinor: 101, rule: {
      ...rule, components: [
        { id: "A", rateBps: 333, source: rule.source },
        { id: "B", rateBps: 333, source: rule.source },
        { id: "C", rateBps: 333, source: rule.source },
      ],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.components.reduce((sum, c) => sum + c.amountMinor, 0), result.taxMinor);
});

test("large safe-integer inputs fail closed before intermediate multiplication overflows", () => {
  const result = calculateVerifiedTaxRule({ ...base, amountMinor: Number.MAX_SAFE_INTEGER });
  assert.equal(result.code, "RATE_OR_AMOUNT_OUT_OF_RANGE");
});
