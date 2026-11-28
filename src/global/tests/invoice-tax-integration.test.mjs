import test from "node:test";
import assert from "node:assert/strict";
import { calculateInvoiceGlobalTax, resolveInvoiceCurrencyForWorkspace } from "../tax/invoice-tax-integration.js";
import { getTaxRuleSet } from "../tax/tax-rule-registry.js";

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
  assert.equal(result.taxSnapshot.immutable, true);
  assert.equal(result.taxSnapshot.rule.id, result.ruleSnapshot.id);
  assert.equal(result.eInvoiceReadiness.transmissionEnabled, false);
});

test("verified Supabase registry rules stay on the verified calculation path for non-US invoices", () => {
  const gbRule = { ...getTaxRuleSet("GB", { asOfDate: "2026-11-20" }).rule, reviewedBy: "Plivex tax rule review" };
  const gb = calculateInvoiceGlobalTax(invoice("GBP", {
    mode: "automatic", resolvedRuleSource: "supabase", ruleMode: "verified",
    resolvedRule: { ...gbRule, verified: true },
  }), profile("GB", "GBP"));
  assert.equal(gb.ok, true, gb.message || gb.code);
  assert.equal(gb.status, "calculated");
  assert.equal(gb.taxMinor, 2000);

  const caRule = getTaxRuleSet("CA", { jurisdictionId: "ON", asOfDate: "2026-11-20" }).rule;
  const ca = calculateInvoiceGlobalTax(invoice("CAD", {
    mode: "automatic", resolvedRuleSource: "supabase", ruleMode: "verified",
    resolvedRule: { ...caRule, verified: true },
    destinationJurisdiction: { province: "ON" },
    collectionObligationAttested: true,
  }), profile("CA", "CAD", { registeredJurisdiction: "CA-ON" }));
  assert.equal(ca.ok, true, ca.message || ca.code);
  assert.equal(ca.status, "calculated");
  assert.equal(ca.taxMinor, 1300);
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
  assert.equal(missing.code, "DESTINATION_JURISDICTION_REQUIRED");

  const result = calculateInvoiceGlobalTax(invoice("USD", {
    mode: "manual",
    collectionObligationAttested: true,
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
  const result = calculateInvoiceGlobalTax(invoice("CAD", { issueDate: "2026-11-20",
    mode: "manual", priceMode: "inclusive",
    collectionObligationAttested: true,
    destinationJurisdiction: { province: "ON" },
    components: [
      { id: "gst", name: "GST", rateBps: 500 },
      { id: "pst", name: "PST", rateBps: 800 },
    ],
  }), profile("CA", "CAD"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxMinor, 1150);
  assert.equal(result.totalMinor, 10000);
});

test("US/Canada automatic rate lookup fails closed without a verified jurisdiction provider", () => {
  const result = calculateInvoiceGlobalTax(invoice("USD"), profile("US", "USD"));
  assert.equal(result.code, "JURISDICTION_RULE_REQUIRED");
});

test("US and Canada manual jurisdiction codes must be valid and country-matched", () => {
  const usInvalid = calculateInvoiceGlobalTax(invoice("USD", {
    mode: "manual", collectionObligationAttested: true,
    destinationJurisdiction: { state: "ZZ", county: "Example County", city: "Example City" },
    components: [{ id: "state", name: "State tax", rateBps: 500 }],
  }), profile("US", "USD", { registeredJurisdiction: "US-ZZ" }));
  assert.equal(usInvalid.code, "INVALID_JURISDICTION");

  const usWrongPrefix = calculateInvoiceGlobalTax(invoice("USD", {
    mode: "manual", collectionObligationAttested: true,
    destinationJurisdiction: { state: "CA", county: "Los Angeles", city: "Los Angeles" },
    components: [{ id: "state", name: "State tax", rateBps: 500 }],
  }), profile("US", "USD", { registeredJurisdiction: "CA-CA" }));
  assert.equal(usWrongPrefix.code, "INVALID_JURISDICTION");

  const caInvalid = calculateInvoiceGlobalTax(invoice("CAD", {
    mode: "manual", collectionObligationAttested: true,
    destinationJurisdiction: { province: "XX" },
    components: [{ id: "gst", name: "GST", rateBps: 500 }],
  }), profile("CA", "CAD", { registeredJurisdiction: "CA-XX" }));
  assert.equal(caInvalid.code, "INVALID_JURISDICTION");
});

test("registration, invoice date, currency and user confirmations fail closed", () => {
  assert.equal(calculateInvoiceGlobalTax(invoice("GBP"), profile("GB", "GBP", { registrationStatus: "pending" })).code, "REGISTRATION_UNVERIFIED");
  assert.equal(calculateInvoiceGlobalTax(invoice("GBP"), profile("GB", "GBP", { registrationEffectiveFrom: "2027-01-01" })).code, "REGISTRATION_NOT_EFFECTIVE");
  assert.equal(calculateInvoiceGlobalTax(invoice("USD"), profile("GB", "GBP")).code, "CURRENCY_MISMATCH");
  assert.equal(calculateInvoiceGlobalTax(invoice("GBP", { placeOfSupplyConfirmed: false }), profile("GB", "GBP")).code, "PLACE_OF_SUPPLY_REQUIRED");
  assert.equal(calculateInvoiceGlobalTax(invoice("GBP", { registrationConfirmed: false }), profile("GB", "GBP")).code, "REGISTRATION_CONFIRMATION_REQUIRED");
});

test("unregistered sellers can issue a confirmed commercial invoice without a tax registration ID", () => {
  const seller = profile("GB", "GBP", { registrationNumber: "", registrationStatus: "unregistered", registrationEffectiveFrom: "" });
  const blockedUntilConfirmed = calculateInvoiceGlobalTax(invoice("GBP"), seller);
  assert.equal(blockedUntilConfirmed.code, "NO_TAX_CONFIRMATION_REQUIRED");
  const commercial = calculateInvoiceGlobalTax(invoice("GBP", { taxMode: "no_tax", noTaxConfirmed: true }), seller);
  assert.equal(commercial.ok, true);
  assert.equal(commercial.status, "not_applicable");
  assert.equal(commercial.taxMinor, 0);
  assert.equal(commercial.totalMinor, 10000);
  assert.equal(commercial.taxSnapshot, null);
  assert.match(commercial.disclosure, /commercial invoice/i);
});

test("unregistered sellers in all six supported non-India countries can issue confirmed commercial invoices", () => {
  for (const [country, currency] of [["US","USD"],["GB","GBP"],["AE","AED"],["CA","CAD"],["AU","AUD"],["SG","SGD"]]) {
    const seller = profile(country, currency, { registrationNumber: "", registrationStatus: "unregistered", registrationEffectiveFrom: "", registeredJurisdiction: "" });
    const result = calculateInvoiceGlobalTax(invoice(currency, { taxMode: "no_tax", noTaxConfirmed: true }), seller);
    assert.equal(result.ok, true, country + ": " + (result.message || result.code));
    assert.equal(result.status, "not_applicable", country);
    assert.equal(result.taxMinor, 0, country);
  }
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
    const result = calculateInvoiceGlobalTax(invoice("GBP", { taxTreatment: taxCategory, taxCategory: "UNSUPPORTED_CATEGORY" }), profile("GB", "GBP"));
    assert.equal(result.code, "NO_EFFECTIVE_VERIFIED_RULE", taxCategory);
  }
});

test("manual calculation rejects unsupported zero-rated, exempt and reduced treatments", () => {
  for (const taxCategory of ["zero-rated", "exempt", "reduced", "reverse-charge", "out-of-scope"]) {
    const result = calculateInvoiceGlobalTax(invoice("USD", {
      mode: "manual",
      taxCategory,
      collectionObligationAttested: true,
      destinationJurisdiction: { state: "CA", county: "Los Angeles", city: "Los Angeles" },
      components: [{ id: "state", name: "State tax", rateBps: 500 }],
    }), profile("US", "USD"));
    assert.equal(result.code, taxCategory ? "UNSUPPORTED_TAX_TREATMENT" : "TAX_CATEGORY_REQUIRED", taxCategory);
  }
});

test("manual jurisdiction does not infer nexus from matching seller and buyer regions", () => {
  const result = calculateInvoiceGlobalTax(invoice("USD", {
    mode: "manual",
    collectionObligationAttested: true,
    destinationJurisdiction: { state: "NY", county: "New York", city: "New York" },
    components: [{ id: "state", name: "State sales tax", rateBps: 400 }],
  }), profile("US", "USD"));
  assert.equal(result.ok, true);
});

test("manual zero-rate components fail closed instead of silently creating a tax-free invoice", () => {
  const result = calculateInvoiceGlobalTax(invoice("USD", {
    mode: "manual",
    collectionObligationAttested: true,
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
  assert.equal(resolveInvoiceCurrencyForWorkspace("ZZ", "EUR"), "");
});

test("manual treatment uses an explicit allowlist and rejects unknown labels", () => {
  for (const taxCategory of ["", "unknown", "special scheme", "reverse charge", "taxable service", "exempt", "standard"]) {
    const result = calculateInvoiceGlobalTax(invoice("GBP", { mode: "manual", taxCategory,
      components: [{ id: "vat", name: "VAT", rateBps: 2000 }] }), profile("GB", "GBP"));
    assert.equal(result.code, taxCategory ? "UNSUPPORTED_TAX_TREATMENT" : "TAX_CATEGORY_REQUIRED", taxCategory);
  }
  const supported = calculateInvoiceGlobalTax(invoice("GBP", { mode: "manual", taxCategory: "standard-rated",
    components: [{ id: "vat", name: "VAT", rateBps: 2000 }] }), profile("GB", "GBP"));
  assert.equal(supported.ok, true);
});

test("US/Canada manual tax validates destination separately from seller registration region", () => {
  const us = calculateInvoiceGlobalTax(invoice("USD", { mode: "manual", collectionObligationAttested: true,
    destinationJurisdiction: { state: "NY", county: "New York", city: "New York" },
    components: [{ id: "state", name: "State tax", rateBps: 500 }] }), profile("US", "USD", { registeredJurisdiction: "US-CA" }));
  assert.equal(us.ok, true);
  const ca = calculateInvoiceGlobalTax(invoice("CAD", { mode: "manual", collectionObligationAttested: true,
    destinationJurisdiction: { province: "BC" },
    components: [{ id: "gst", name: "GST", rateBps: 500 }] }), profile("CA", "CAD", { registeredJurisdiction: "CA-ON" }));
  assert.equal(ca.ok, true);
});

test("US/Canada manual rates require user attestation", () => {
  const result = calculateInvoiceGlobalTax(invoice("USD", { mode: "manual",
    destinationJurisdiction: { state: "CA", county: "Los Angeles", city: "Los Angeles" },
    components: [{ id: "state", name: "State tax", rateBps: 500 }] }), profile("US", "USD"));
  assert.equal(result.code, "COLLECTION_OBLIGATION_ATTESTATION_REQUIRED");
});


test("Canada automatic GST/HST uses selected destination province and a confirmed collection obligation", () => {
  const document = invoice("CAD", {
    mode: "automatic",
    destinationJurisdiction: { province: "ON" },
    collectionObligationAttested: true,
  });
  document.issueDate = "2026-11-20";
  const result = calculateInvoiceGlobalTax(document, profile("CA", "CAD"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxMinor, 1300);
  assert.equal(result.totalMinor, 11300);
  assert.equal(result.jurisdictionEvidence, "user-attested");
});

test("Australia GST-free category uses the exact verified GST-free rule", () => {
  const document = invoice("AUD", {
    mode: "automatic",
    taxTreatment: "gst-free",
    taxCategory: "AU_GST_FREE_BASIC_FOOD",
  });
  document.issueDate = "2026-11-20";
  const result = calculateInvoiceGlobalTax(document, profile("AU", "AUD"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.treatment, "gst-free");
  assert.equal(result.taxMinor, 0);
  assert.match(result.taxDisclosure, /GST-free supply/);
});


test("invoice percentage discount is applied in integer minor units before VAT", () => {
  const document = invoice("GBP");
  document.discountType = "percent";
  document.discount = 10;
  const result = calculateInvoiceGlobalTax(document, profile("GB", "GBP"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxableMinor, 9000);
  assert.equal(result.taxMinor, 1800);
  assert.equal(result.totalMinor, 10800);
});

test("invoice fixed discount is applied before VAT and cannot exceed the subtotal", () => {
  const document = invoice("GBP");
  document.discountType = "fixed";
  document.discount = 10;
  const result = calculateInvoiceGlobalTax(document, profile("GB", "GBP"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxableMinor, 9000);
  assert.equal(result.taxMinor, 1800);
  assert.equal(result.totalMinor, 10800);
});

test("invalid percentage discounts fail closed instead of being silently clamped", () => {
  const document = invoice("GBP");
  document.discountType = "percent";
  document.discount = 101;
  const result = calculateInvoiceGlobalTax(document, profile("GB", "GBP"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_AMOUNT");
});


test("mixed UK invoice lines calculate separate verified rates after exact percentage discount allocation", () => {
  const mixed = invoice("GBP");
  mixed.discountType = "percent";
  mixed.discount = 10;
  mixed.items = [
    { id: "standard-line", description: "Standard goods", quantity: 1, rate: 100 },
    {
      id: "reduced-line", description: "Domestic fuel and power", quantity: 1, rate: 100,
      taxTreatment: "reduced",
      taxCategory: "GB_REDUCED_DOMESTIC_FUEL_POWER",
      taxTreatmentConfirmed: true,
      taxCategoryConfirmed: true,
    },
  ];
  const result = calculateInvoiceGlobalTax(mixed, profile("GB", "GBP"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.status, "calculated");
  assert.equal(result.taxableMinor, 18000);
  assert.equal(result.taxMinor, 2250);
  assert.equal(result.totalMinor, 20250);
  assert.equal(result.lineTaxBreakdown.length, 2);
  assert.equal(result.lineTaxBreakdown[0].taxMinor, 1800);
  assert.equal(result.lineTaxBreakdown[1].taxMinor, 450);
  assert.equal(result.lineTaxBreakdown[0].treatment, "standard");
  assert.equal(result.lineTaxBreakdown[1].treatment, "reduced");
  assert.equal(result.taxSnapshot.immutable, true);
  assert.equal(result.taxSnapshot.treatment, "mixed");
  assert.equal(result.taxSnapshot.lineRules.length, 2);
});

test("line-level tax overrides require explicit treatment and category confirmation", () => {
  const mixed = invoice("GBP");
  mixed.items = [{
    id: "special-line", quantity: 1, rate: 100,
    taxTreatment: "reduced",
    taxCategory: "GB_REDUCED_DOMESTIC_FUEL_POWER",
    taxTreatmentConfirmed: true,
  }];
  const result = calculateInvoiceGlobalTax(mixed, profile("GB", "GBP"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "LINE_TAX_CONFIRMATION_REQUIRED");
});

test("fixed invoice discount allocation across unequal lines reconciles exactly", () => {
  const mixed = invoice("GBP");
  mixed.discountType = "fixed";
  mixed.discount = 1.01;
  mixed.items = [
    { id: "a", quantity: 1, rate: 1 },
    { id: "b", quantity: 2, rate: 1 },
    { id: "c", quantity: 3, rate: 1 },
  ];
  const result = calculateInvoiceGlobalTax(mixed, profile("GB", "GBP"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxableMinor, 499);
  assert.equal(result.taxMinor, 100);
  assert.equal(result.totalMinor, 599);
  assert.equal(result.lineTaxBreakdown.reduce((sum, line) => sum + line.amountMinor, 0), 499);
});


test("Canada automatic GST/HST resolves a reviewed province rule and exact source components", () => {
  const result = calculateInvoiceGlobalTax(invoice("CAD", {
    destinationJurisdiction: { province: "ON" },
    collectionObligationAttested: true,
  }), profile("CA", "CAD"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxMinor, 1300);
  assert.equal(result.totalMinor, 11300);
  assert.equal(result.components[0].source.startsWith("https://"), true);
  assert.equal(result.lineTaxBreakdown[0].ruleSnapshot.jurisdictionId, "ON");
});


test("UK construction reverse charge keeps supplier invoice tax at zero and records recipient VAT", () => {
  const result = calculateInvoiceGlobalTax(invoice("GBP", {
    taxTreatment: "reverse-charge",
    taxCategory: "GB_REVERSE_CHARGE_CONSTRUCTION_STANDARD",
    reverseChargeEvidence: {
      recipientVatRegisteredConfirmed: true,
      constructionIndustrySchemeConfirmed: true,
      recipientNotEndUserConfirmed: true,
      supplyWithinConstructionIndustryScheme: true,
      employmentBusinessExcluded: true,
    },
  }), profile("GB", "GBP"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxMinor, 0);
  assert.equal(result.totalMinor, 10000);
  assert.equal(result.recipientTaxMinor, 2000);
  assert.equal(result.recipientAccountingRequired, true);
  assert.equal(result.taxCharged, false);
  assert.equal(result.taxSnapshot.recipientTaxMinor, 2000);
  assert.equal(result.taxSnapshot.recipientTaxComponents[0].amountMinor, 2000);
});

test("UAE electronic-device reverse charge requires recipient declaration evidence", () => {
  const result = calculateInvoiceGlobalTax(invoice("AED", {
    taxTreatment: "reverse-charge",
    taxCategory: "AE_REVERSE_CHARGE_ELECTRONIC_DEVICES",
    reverseChargeEvidence: {
      recipientVatRegisteredConfirmed: true,
      recipientIntendedResaleOrManufacture: true,
      recipientDeclarationReceived: true,
    },
  }), profile("AE", "AED"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxMinor, 0);
  assert.equal(result.recipientTaxMinor, 500);
  assert.equal(result.totalMinor, 10000);
  const missingEvidence = calculateInvoiceGlobalTax(invoice("AED", {
    taxTreatment: "reverse-charge",
    taxCategory: "AE_REVERSE_CHARGE_ELECTRONIC_DEVICES",
    reverseChargeEvidence: {},
  }), profile("AE", "AED"));
  assert.equal(missingEvidence.code, "AE_REVERSE_CHARGE_EVIDENCE_REQUIRED");
});


test("UAE precious-metals reverse charge uses the effective 2025 rule and pre-supply recipient declaration", () => {
  const result = calculateInvoiceGlobalTax(invoice("AED", {
    issueDate: "2026-11-20",
    taxTreatment: "reverse-charge",
    taxCategory: "AE_REVERSE_CHARGE_PRECIOUS_METALS_STONES",
    reverseChargeEvidence: {
      recipientVatRegisteredConfirmed: true,
      recipientIntendedResaleOrManufacture: true,
      recipientDeclarationReceived: true,
    },
  }), profile("AE", "AED"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxMinor, 0);
  assert.equal(result.recipientTaxMinor, 500);
  assert.equal(result.taxSnapshot.rule.id, "AE-VAT-REVERSE-CHARGE-PRECIOUS-METALS-2026-11");
});


test("mixed standard and reverse-charge lines reconcile seller and recipient tax separately", () => {
  const document = invoice("GBP", { taxTreatment: "standard" });
  document.items = [
    { id: "standard", description: "Standard supply", quantity: 1, rate: 100 },
    {
      id: "construction", description: "CIS construction service", quantity: 1, rate: 100,
      taxTreatment: "reverse-charge",
      taxCategory: "GB_REVERSE_CHARGE_CONSTRUCTION_STANDARD",
      taxTreatmentConfirmed: true,
      taxCategoryConfirmed: true,
    },
  ];
  document.globalTax.reverseChargeEvidence = {
    recipientVatRegisteredConfirmed: true,
    constructionIndustrySchemeConfirmed: true,
    recipientNotEndUserConfirmed: true,
    supplyWithinConstructionIndustryScheme: true,
    employmentBusinessExcluded: true,
  };
  const result = calculateInvoiceGlobalTax(document, profile("GB", "GBP"));
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxMinor, 2000);
  assert.equal(result.recipientTaxMinor, 2000);
  assert.equal(result.totalMinor, 22000);
  assert.equal(result.taxSnapshot.immutable, true);
  assert.equal(result.taxSnapshot.treatment, "mixed");
  assert.equal(result.taxSnapshot.lineRules.length, 2);
});
