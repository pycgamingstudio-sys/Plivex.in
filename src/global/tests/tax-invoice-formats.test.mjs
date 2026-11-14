import test from "node:test";
import assert from "node:assert/strict";
import { getTaxInvoiceFormat, validateTaxInvoiceSellerFields } from "../tax/tax-invoice-formats.js";

const expected = {
  IN: ["Tax Invoice", "GSTIN", "HSN/SAC"],
  US: ["Sales Tax Invoice", "Sales tax permit number", "Product/service tax category"],
  GB: ["VAT Invoice", "VAT registration number", "VAT treatment"],
  AE: ["Tax Invoice", "TRN", "VAT treatment"],
  CA: ["GST/HST Invoice", "GST/HST account number", "Supply tax treatment"],
  AU: ["Tax Invoice", "ABN", "GST-free / input-taxed / taxable"],
  SG: ["Tax Invoice", "GST registration number", "Standard / zero-rated / exempt"],
};

test("all seven selectable countries have distinct tax invoice metadata", () => {
  for (const [country, [title, registration, classification]] of Object.entries(expected)) {
    const format = getTaxInvoiceFormat(country);
    assert.ok(format, country);
    assert.equal(format.title, title);
    assert.equal(format.registrationLabel, registration);
    assert.equal(format.classificationLabel, classification);
    assert.ok(format.taxComponents.length > 0);
  }
});

test("country lookup is case-insensitive and returns defensive arrays", () => {
  const first = getTaxInvoiceFormat("ca");
  first.taxComponents.push("FAKE");
  assert.equal(getTaxInvoiceFormat("CA").taxComponents.includes("FAKE"), false);
});

test("unknown countries fail closed", () => {
  assert.equal(getTaxInvoiceFormat("ZZ"), null);
  assert.deepEqual(validateTaxInvoiceSellerFields("ZZ", {}), { ok: false, missing: ["supported country"] });
});

test("registered seller fields are checked without claiming authority verification", () => {
  assert.deepEqual(validateTaxInvoiceSellerFields("GB", { name: "Example Ltd", address: "London" }), {
    ok: false, missing: ["taxRegistrationNumber"],
  });
  assert.deepEqual(validateTaxInvoiceSellerFields("GB", {
    name: "Example Ltd", address: "London", taxRegistrationNumber: "GB123456",
  }), { ok: true, missing: [] });
});
