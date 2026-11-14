import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTax, formatTaxMoney, getStandardRateBaseline,
} from "../tax/tax-engine.js";

const base = {
  countryCode: "GB", currencyCode: "GBP", currencyMinorUnits: 2,
  amountMinor: 10000, invoiceDate: "2026-11-14",
  sellerRegistration: {
    verified: true, status: "registered", registrationNumber: "GB123456789",
    effectiveFrom: "2026-01-01",
  },
  placeOfSupplyVerified: true, placeOfSupply: "GB",
  taxCategoryVerified: true, taxCategory: "standard-rated",
  treatment: "standard", priceMode: "exclusive",
};

test("UK standard VAT calculates exclusive price using integer minor units", () => {
  const result = calculateTax(base);
  assert.equal(result.ok, true);
  assert.equal(result.taxableMinor, 10000);
  assert.equal(result.taxMinor, 2000);
  assert.equal(result.totalMinor, 12000);
  assert.equal(result.components[0].rateBps, 2000);
  assert.equal(result.ruleSnapshot.source, "https://www.gov.uk/vat-rates");
});

test("inclusive VAT extracts tax from total without changing total", () => {
  const result = calculateTax({ ...base, priceMode: "inclusive", amountMinor: 12000 });
  assert.equal(result.ok, true);
  assert.equal(result.taxableMinor, 10000);
  assert.equal(result.taxMinor, 2000);
  assert.equal(result.totalMinor, 12000);
});

test("verified standard baselines exist for GB, AE, AU and SG", () => {
  assert.equal(getStandardRateBaseline("GB").rateBps, 2000);
  assert.equal(getStandardRateBaseline("AE").rateBps, 500);
  assert.equal(getStandardRateBaseline("AU").rateBps, 1000);
  assert.equal(getStandardRateBaseline("SG").rateBps, 900);
  assert.equal(getStandardRateBaseline("US"), null);
  assert.equal(getStandardRateBaseline("CA"), null);
});

test("unregistered seller fails closed", () => {
  const result = calculateTax({ ...base, sellerRegistration: { verified: false } });
  assert.equal(result.status, "needs_review");
  assert.equal(result.code, "REGISTRATION_UNVERIFIED");
});

test("registration effective date is enforced", () => {
  const result = calculateTax({
    ...base,
    invoiceDate: "2025-12-31",
  });
  assert.equal(result.code, "REGISTRATION_NOT_EFFECTIVE");
});

test("unverified place of supply and tax category fail closed", () => {
  assert.equal(calculateTax({ ...base, placeOfSupplyVerified: false }).code, "PLACE_OF_SUPPLY_REQUIRED");
  assert.equal(calculateTax({ ...base, taxCategoryVerified: false }).code, "TAX_CATEGORY_REQUIRED");
});

test("zero rated, exempt and other non-standard treatments require specific rules", () => {
  for (const treatment of ["zero-rated", "exempt", "reverse-charge", "out-of-scope"]) {
    assert.equal(calculateTax({ ...base, treatment }).code, "TREATMENT_RULE_REQUIRED");
  }
});

test("US, Canada and India cannot silently use generic national rates", () => {
  for (const countryCode of ["US", "CA", "IN"]) {
    assert.equal(calculateTax({ ...base, countryCode }).code, "JURISDICTION_ADAPTER_REQUIRED");
  }
});

test("currency mismatch and invalid minor units are rejected", () => {
  assert.equal(calculateTax({ ...base, currencyCode: "USD" }).code, "CURRENCY_MISMATCH");
  assert.equal(calculateTax({ ...base, amountMinor: 1.5 }).code, "INVALID_AMOUNT");
});

test("rule provenance must be valid and effective on invoice date", () => {
  assert.equal(calculateTax({ ...base, rule: { rateBps: 2000 } }).code, "INVALID_TAX_RULE");
  const rule = {
    ...getStandardRateBaseline("GB"),
    id: "future-rule", effectiveFrom: "2027-01-01",
    coverage: "verified", verified: true,
  };
  assert.equal(calculateTax({ ...base, rule }).code, "RULE_NOT_EFFECTIVE");
});

test("formatting never performs FX conversion", () => {
  assert.match(formatTaxMoney(12000, "GBP", "en-GB"), /£/);
  assert.throws(() => formatTaxMoney(12000, "XYZ", "en"));
});
