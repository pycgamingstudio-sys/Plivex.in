import test from "node:test";
import assert from "node:assert/strict";
import { invoiceSaveSignature } from "../tax/invoice-save-signature.js";

const base = {
  client: { name: "Customer Ltd", email: "accounts@example.test" },
  business: { name: "Seller Ltd", address: "1 Main Street" },
  issueDate: "2026-11-14",
  dueDate: "2026-12-14",
  currency: "GBP",
  taxMode: "split",
  taxRate: 0,
  discountType: "percent",
  discount: 0,
  notes: "",
  terms: "",
  items: [{ description: "Consulting", quantity: 1, rate: 100, gstRate: 0 }],
  globalTax: {
    countryCode: "GB", mode: "automatic", priceMode: "exclusive",
    registrationConfirmed: true, placeOfSupply: "United Kingdom",
    placeOfSupplyConfirmed: true, taxCategory: "standard-rated",
    taxCategoryConfirmed: true,
  },
  globalTaxProfileSnapshot: {
    countryCode: "GB", registrationNumber: "GB123456789",
    registrationStatus: "registered", registrationEffectiveFrom: "2026-01-01",
  },
  globalTaxCalculation: {
    ok: true, status: "calculated", countryCode: "GB",
    currencyCode: "GBP", taxableMinor: 10000, taxMinor: 2000,
    totalMinor: 12000,
  },
};

test("invoice save signature is deterministic for unchanged tax snapshot", () => {
  assert.equal(invoiceSaveSignature(base), invoiceSaveSignature(structuredClone(base)));
});

test("changing manual tax components invalidates the invoice save cache key", () => {
  const changed = {
    ...base,
    globalTax: {
      ...base.globalTax,
      mode: "manual",
      components: [{ id: "vat", name: "VAT", rateBps: 1750 }],
    },
  };
  assert.notEqual(invoiceSaveSignature(base), invoiceSaveSignature(changed));
});

test("changing workspace registration or jurisdiction invalidates the invoice save cache key", () => {
  const changed = {
    ...base,
    globalTaxProfileSnapshot: {
      ...base.globalTaxProfileSnapshot,
      registrationNumber: "GB987654321",
    },
  };
  assert.notEqual(invoiceSaveSignature(base), invoiceSaveSignature(changed));
});

test("changing the calculated tax snapshot invalidates the invoice save cache key", () => {
  const changed = {
    ...base,
    globalTaxCalculation: {
      ...base.globalTaxCalculation,
      taxMinor: 1750,
      totalMinor: 11750,
    },
  };
  assert.notEqual(invoiceSaveSignature(base), invoiceSaveSignature(changed));
});

test("changing India HSN/SAC invalidates the invoice save cache key", () => {
  const changed = {
    ...base,
    items: [{ ...base.items[0], hsnSac: "998313" }],
  };
  const existing = { ...base, items: [{ ...base.items[0], hsnSac: "998312" }] };
  assert.notEqual(invoiceSaveSignature(existing), invoiceSaveSignature(changed));
});
