import test from "node:test";
import assert from "node:assert/strict";
import { calculateGlobalTax } from "../tax/global-tax-engine.js";

const base = {
  countryCode: "GB", currencyCode: "GBP", currencyMinorUnits: 2, amountMinor: 10000,
  invoiceDate: "2026-11-14",
  sellerRegistration: {
    verified: true, status: "registered", registrationNumber: "GB123456789",
    effectiveFrom: "2026-01-01",
  },
  placeOfSupplyVerified: true, placeOfSupply: "GB",
  taxCategoryVerified: true, taxCategory: "standard-rated",
  treatment: "standard", priceMode: "exclusive",
};

test("router calculates standard-rated GB, AE, AU and SG with country-specific baselines", () => {
  const expected = { GB: ["GBP", 2000], AE: ["AED", 500], AU: ["AUD", 1000], SG: ["SGD", 900] };
  for (const [countryCode, [currencyCode, rateBps]] of Object.entries(expected)) {
    const result = calculateGlobalTax({
      ...base, countryCode, currencyCode,
      sellerRegistration: { ...base.sellerRegistration, registrationNumber: "REG-VERIFIED" },
    });
    assert.equal(result.ok, true, countryCode);
    assert.equal(result.components[0].rateBps, rateBps, countryCode);
  }
});

test("router never invents US or Canadian jurisdiction rates", () => {
  assert.equal(calculateGlobalTax({ ...base, countryCode: "US", currencyCode: "USD" }).code, "JURISDICTION_RULE_REQUIRED");
  assert.equal(calculateGlobalTax({ ...base, countryCode: "CA", currencyCode: "CAD" }).code, "JURISDICTION_RULE_REQUIRED");
});

test("India remains delegated to the established GST path", () => {
  assert.equal(calculateGlobalTax({ ...base, countryCode: "IN", currencyCode: "INR" }).code, "INDIA_LEGACY_ADAPTER_REQUIRED");
});

test("unsupported country and incomplete tax profile fail closed", () => {
  assert.equal(calculateGlobalTax({ ...base, countryCode: "JP", currencyCode: "JPY" }).code, "UNSUPPORTED_COUNTRY");
  assert.equal(calculateGlobalTax({ ...base, sellerRegistration: { verified: false } }).code, "REGISTRATION_UNVERIFIED");
  assert.equal(calculateGlobalTax({ ...base, placeOfSupplyVerified: false }).code, "PLACE_OF_SUPPLY_REQUIRED");
  assert.equal(calculateGlobalTax({ ...base, taxCategoryVerified: false }).code, "TAX_CATEGORY_REQUIRED");
});
