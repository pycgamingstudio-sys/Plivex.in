import test from "node:test";
import assert from "node:assert/strict";
import { getCountryInvoiceRequirements, validateCountryInvoice } from "../tax/country-invoice-requirements.js";
const gb = {
  currencyCode: "GBP", invoiceNumber: "INV-1", issueDate: "2026-11-16", taxPointDate: "2026-11-16",
  sellerName: "Seller Ltd", sellerAddress: "London", sellerRegistrationNumber: "GB123",
  buyerName: "Buyer Ltd", buyerAddress: "Leeds", lineItems: [{ description: "Service", quantity: 1, unitPriceMinor: 10000 }],
  netAmountMinor: 10000, taxAmountMinor: 2000, totalAmountMinor: 12000,
};
test("GB checklist requires the core VAT invoice fields", () => {
  assert.equal(validateCountryInvoice("GB", gb).ok, true);
  assert.deepEqual(validateCountryInvoice("GB", { ...gb, buyerAddress: "" }).missing, ["buyerAddress"]);
});
test("UAE checklist is AED-only and rejects missing required values", () => {
  const ae = { ...gb, currencyCode: "AED", supplyDate: "2026-11-16" };
  assert.equal(validateCountryInvoice("AE", ae).ok, true);
  assert.equal(validateCountryInvoice("AE", { ...ae, currencyCode: "USD" }).code, "INVOICE_CURRENCY_MISMATCH");
});
test("Australia requires buyer details for invoices at or above AUD 1,000", () => {
  const au = { ...gb, currencyCode: "AUD", totalAmountMinor: 100000, sellerRegistrationNumber: "ABN" };
  assert.equal(validateCountryInvoice("AU", au).code, "AU_BUYER_DETAILS_REQUIRED");
  assert.equal(validateCountryInvoice("AU", { ...au, buyerName: "Buyer", buyerRegistrationNumber: "ABN2" }).ok, true);
});
test("US, Canada and India do not silently use generic invoice rules", () => {
  assert.equal(validateCountryInvoice("US", {}).code, "JURISDICTION_INVOICE_REVIEW_REQUIRED");
  assert.equal(validateCountryInvoice("CA", {}).code, "JURISDICTION_INVOICE_REVIEW_REQUIRED");
  assert.equal(validateCountryInvoice("IN", {}).code, "INDIA_LEGACY_ADAPTER_REQUIRED");
  assert.equal(getCountryInvoiceRequirements("ZZ"), null);
});
