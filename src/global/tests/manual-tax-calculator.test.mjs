import test from "node:test";
import assert from "node:assert/strict";
import { calculateManualTax } from "../tax/manual-tax-calculator.js";

const base = {
  countryCode: "GB", currencyCode: "GBP", currencyMinorUnits: 2,
  amountMinor: 10000, priceMode: "exclusive",
  components: [{ id: "vat", name: "VAT", rateBps: 2000 }],
};

test("manual rate supports exclusive and inclusive amounts with explicit warning", () => {
  const exclusive = calculateManualTax(base);
  assert.equal(exclusive.ok, true);
  assert.equal(exclusive.status, "manual_unverified");
  assert.equal(exclusive.taxMinor, 2000);
  assert.equal(exclusive.totalMinor, 12000);
  const inclusive = calculateManualTax({ ...base, priceMode: "inclusive" });
  assert.equal(inclusive.taxMinor, 1667);
  assert.equal(inclusive.taxableMinor, 8333);
});

test("US and Canada require explicit jurisdiction confirmation", () => {
  assert.equal(calculateManualTax({ ...base, countryCode: "US", currencyCode: "USD" }).code, "JURISDICTION_CONFIRMATION_REQUIRED");
  assert.equal(calculateManualTax({ ...base, countryCode: "CA", currencyCode: "CAD", jurisdictionConfirmed: true }).ok, true);
});

test("manual rates reject invalid components and India uses legacy GST", () => {
  assert.equal(calculateManualTax({ ...base, components: [{ id: "x", rateBps: 10001 }] }).code, "INVALID_COMPONENT");
  assert.equal(calculateManualTax({ ...base, countryCode: "IN", currencyCode: "INR" }).code, "UNSUPPORTED_COUNTRY");
});

test("manual calculator rejects unsafe arithmetic", () => {
  const result = calculateManualTax({ ...base, amountMinor: Number.MAX_SAFE_INTEGER });
  assert.equal(result.ok, false);
});
