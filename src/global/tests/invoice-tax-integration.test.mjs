import test from "node:test";
import assert from "node:assert/strict";
import { calculateInvoiceGlobalTax, resolveInvoiceCurrencyForWorkspace } from "../tax/invoice-tax-integration.js";

const profile = (countryCode, currencyCode, overrides = {}) => ({
  countryCode, currencyCode,
  registrationNumber: "REG-123",
  registrationStatus: "registered",
  registrationEffectiveFrom: "2026-01-01",
  registeredJurisdiction: countryCode === "US" ? "US-CA" : countryCode === "CA" ? "CA-ON" : "",
  ...overrides,
});
const invoice = (currency, globalTax = {}) => ({
  currency, issueDate: "2026-11-14", business: { name: "Seller Ltd", address: "1 Business Street" },
  items: [{ id: "a", quantity: 1, rate: 100 }],
  discountType: "percent", discount: 0,
  globalTax: {
    mode: "automatic", priceMode: "exclusive",
    placeOfSupply: "Destination", placeOfSupplyConfirmed: true,
    taxCategory: "standard-rated", taxCategoryConfirmed: true,
    registrationConfirmed: true,
    ...globalTax,
  },
});

test("UK standard VAT integrates with the invoice amount and retains rule provenance", () => {
  const result = calculateInvoiceGlobalTax(invoice("GBP"), profile("GB", "GBP"));
  assert.equal(result.ok, true);
  assert.equal(result.status, "calculated");
  assert.equal(result.taxMinor, 2000);
  assert.equal(result.totalMinor, 12000);
  assert.equal(result.registrationEvidence, "user-attested");
  assert.equal(result.ruleSnapshot.source, "https://www.gov.uk/vat-rates");
});

test("UAE, Australia and Singapore use only their country standard baselines", () => {
  const expected = { AE: ["AED", 500], AU: ["AUD", 1000], SG: ["SGD", 900] };
  for (const [country, [currency, rate]] of Object.entries(expected)) {
    const result = calculateInvoiceGlobalTax(invoice(currency), profile(country, currency));
    assert.equal(result.ok, true, country);
    assert.equal(result.components[0].rateBps, rate, country);
  }
});

test("US manual invoice requires state, county, city and collection-obligation confirmation", () => {
  const missing = calculateInvoiceGlobalTax(invoice("USD", {
    mode: "manual",
    components: [{ id: "state", name: "State", rateBps: 500 }],
  }), profile("US", "USD"));
  assert.equal(missing.code, "JURISDICTION_OR_NEXUS_REQUIRED");

  const result = calculateInvoiceGlobalTax(invoice("USD", {
    mode: "manual",
    collectionObligationConfirmed: true,
    destinationJurisdiction: { state: "CA", county: "Los Angeles", city: "Los Angeles" },
    components: [
      { id: "state", name: "State sales tax", rateBps: 500 },
      { id: "county", name: "County sales tax", rateBps: 125 },
    ],
  }), profile("US", "USD"));
  assert.equal(result.ok, true);
  assert.equal(result.status, "manual_unverified");
  assert.equal(result.taxMinor, 625);
  assert.match(result.warning, /not independently verified/i);
});

test("Canada manual inclusive GST/PST preserves the entered gross total", () => {
  const result = calculateInvoiceGlobalTax(invoice("CAD", {
    mode: "manual", priceMode: "inclusive",
    collectionObligationConfirmed: true,
    destinationJurisdiction: { province: "ON" },
    components: [
      { id: "gst", name: "GST", rateBps: 500 },
      { id: "pst", name: "PST", rateBps: 800 },
    ],
  }), profile("CA", "CAD"));
  assert.equal(result.ok, true);
  assert.equal(result.taxMinor, 1150);
  assert.equal(result.totalMinor, 10000);
});

test("US/Canada automatic rate lookup fails closed without a verified jurisdiction provider", () => {
  const result = calculateInvoiceGlobalTax(invoice("USD"), profile("US", "USD"));
  assert.equal(result.code, "JURISDICTION_RULE_REQUIRED");
});

test("registration, invoice date, currency and user confirmations fail closed", () => {
  assert.equal(calculateInvoiceGlobalTax(invoice("GBP"), profile("GB", "GBP", { registrationStatus: "pending" })).code, "REGISTRATION_UNVERIFIED");
  assert.equal(calculateInvoiceGlobalTax(invoice("GBP"), profile("GB", "GBP", { registrationEffectiveFrom: "2027-01-01" })).code, "REGISTRATION_NOT_EFFECTIVE");
  assert.equal(calculateInvoiceGlobalTax(invoice("USD"), profile("GB", "GBP")).code, "CURRENCY_MISMATCH");
  assert.equal(calculateInvoiceGlobalTax(invoice("GBP", { placeOfSupplyConfirmed: false }), profile("GB", "GBP")).code, "PLACE_OF_SUPPLY_REQUIRED");
  assert.equal(calculateInvoiceGlobalTax(invoice("GBP", { registrationConfirmed: false }), profile("GB", "GBP")).code, "REGISTRATION_CONFIRMATION_REQUIRED");
});

test("India remains delegated to the existing GST path", () => {
  assert.deepEqual(calculateInvoiceGlobalTax(invoice("INR"), profile("IN", "INR")), {
    ok: true, status: "india_legacy", countryCode: "IN",
  });
});

test("country invoice format requires the seller address and registration fields", () => {
  const noAddress = invoice("GBP");
  noAddress.business.address = "";
  assert.equal(calculateInvoiceGlobalTax(noAddress, profile("GB", "GBP")).code, "SELLER_FIELDS_REQUIRED");
});

test("automatic calculation rejects reduced, zero-rated and exempt treatments", () => {
  for (const taxCategory of ["reduced", "zero-rated", "exempt"]) {
    const result = calculateInvoiceGlobalTax(invoice("GBP", { taxCategory }), profile("GB", "GBP"));
    assert.equal(result.code, "UNSUPPORTED_TAX_TREATMENT", taxCategory);
  }
});

test("manual calculation rejects unsupported zero-rated, exempt and reduced treatments", () => {
  for (const taxCategory of ["zero-rated", "exempt", "reduced", "reverse-charge", "out-of-scope"]) {
    const result = calculateInvoiceGlobalTax(invoice("USD", {
      mode: "manual",
      taxCategory,
      collectionObligationConfirmed: true,
      destinationJurisdiction: { state: "CA", county: "Los Angeles", city: "Los Angeles" },
      components: [{ id: "state", name: "State tax", rateBps: 500 }],
    }), profile("US", "USD"));
    assert.equal(result.code, "UNSUPPORTED_TAX_TREATMENT", taxCategory);
  }
});

test("manual jurisdiction must match the saved seller registration region", () => {
  const result = calculateInvoiceGlobalTax(invoice("USD", {
    mode: "manual",
    collectionObligationConfirmed: true,
    destinationJurisdiction: { state: "NY", county: "New York", city: "New York" },
    components: [{ id: "state", name: "State sales tax", rateBps: 400 }],
  }), profile("US", "USD"));
  assert.equal(result.code, "JURISDICTION_OR_NEXUS_REQUIRED");
});

test("manual zero-rate components fail closed instead of silently creating a tax-free invoice", () => {
  const result = calculateInvoiceGlobalTax(invoice("USD", {
    mode: "manual",
    collectionObligationConfirmed: true,
    destinationJurisdiction: { state: "CA", county: "Los Angeles", city: "Los Angeles" },
    components: [{ id: "state", name: "State sales tax", rateBps: 0 }],
  }), profile("US", "USD"));
  assert.equal(result.code, "MANUAL_COMPONENT_INVALID");
});


test("workspace country always selects its required invoice currency, including after country changes", () => {
  const expected = { IN: "INR", US: "USD", GB: "GBP", AE: "AED", CA: "CAD", AU: "AUD", SG: "SGD" };
  for (const [country, currency] of Object.entries(expected)) {
    assert.equal(resolveInvoiceCurrencyForWorkspace(country, "INR"), currency, country);
  }
  assert.equal(resolveInvoiceCurrencyForWorkspace("CA", "GBP"), "CAD");
  assert.equal(resolveInvoiceCurrencyForWorkspace("IN", "GBP"), "GBP");
  assert.equal(resolveInvoiceCurrencyForWorkspace("ZZ", "EUR"), "EUR");
});
