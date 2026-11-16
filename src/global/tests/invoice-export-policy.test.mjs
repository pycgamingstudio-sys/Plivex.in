import test from "node:test";
import assert from "node:assert/strict";
import { getGlobalInvoiceTaxValidationError } from "../tax/invoice-export-policy.js";

test("India legacy invoice flow is not affected by Global tax validation", () => {
  assert.equal(getGlobalInvoiceTaxValidationError({ countryCode: "IN", taxCalculation: null }), "");
});

test("Global draft PDF export is allowed when tax details are incomplete", () => {
  assert.equal(getGlobalInvoiceTaxValidationError({
    countryCode: "US",
    taxCalculation: { ok: false, message: "A verified jurisdiction is required." },
    allowDraftExport: true,
  }), "");
});

test("Global issuance remains blocked when tax calculation is not ready", () => {
  assert.equal(getGlobalInvoiceTaxValidationError({
    countryCode: "US",
    taxCalculation: { ok: false, message: "A verified jurisdiction is required." },
  }), "A verified jurisdiction is required.");
});

test("successful Global tax calculation passes issuance validation", () => {
  assert.equal(getGlobalInvoiceTaxValidationError({
    countryCode: "GB",
    taxCalculation: { ok: true, status: "calculated" },
  }), "");
});

test("missing Global tax calculation fails closed for issuance", () => {
  assert.equal(getGlobalInvoiceTaxValidationError({ countryCode: "CA", taxCalculation: null }),
    "Complete the tax details before issuing this invoice.");
});
