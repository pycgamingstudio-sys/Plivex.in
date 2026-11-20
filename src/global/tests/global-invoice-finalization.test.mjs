import test from "node:test";
import assert from "node:assert/strict";
import {
  createGlobalInvoiceTaxSnapshot,
  getEInvoiceReadiness,
  prepareEInvoiceSubmission,
} from "../tax/global-invoice-finalization.js";

const rule = {
  id: "GB-VAT-STANDARD-2026-11", version: "2026.11", catalogVersion: "2026.11.1",
  source: "https://www.gov.uk/vat-rates", sourceAuthority: "UK HM Revenue & Customs", treatment: "standard",
  effectiveFrom: "2011-01-04", effectiveTo: null, coverage: "standard-rate-only",
};
const result = {
  ok: true, status: "calculated", countryCode: "GB", currencyCode: "GBP",
  currencyMinorUnits: 2, engineVersion: "1.0.0", treatment: "standard",
  taxDisclosure: "Tax charged at the verified standard rate.", taxCharged: true, taxCategory: "general-goods",
  priceMode: "exclusive", taxableMinor: 10000, taxMinor: 2000, totalMinor: 12000,
  registrationEvidence: "user-attested", ruleSnapshot: rule,
  components: [{ id: "GB-VAT-STANDARD", name: "VAT", rateBps: 2000, amountMinor: 2000 }],
};
const makeSnapshot = (overrides = {}) => createGlobalInvoiceTaxSnapshot({
  countryCode: "GB", invoiceDate: "2026-11-15", taxResult: result, ...overrides,
});

test("all seven countries expose explicit e-invoice status without claiming transmission", () => {
  for (const country of ["IN", "US", "GB", "AE", "CA", "AU", "SG"]) {
    const readiness = getEInvoiceReadiness(country);
    assert.equal(readiness.ok, true, country);
    assert.equal(readiness.transmissionEnabled, false, country);
    assert.ok(readiness.status);
  }
  assert.equal(getEInvoiceReadiness("ZZ").code, "EINVOICE_COUNTRY_NOT_CONFIGURED");
});

test("only calculated, source-backed, effective tax results can be frozen", () => {
  const created = makeSnapshot();
  assert.equal(created.ok, true);
  assert.equal(created.snapshot.totalMinor, 12000);
  assert.equal(created.snapshot.schemaVersion, "2");
  assert.equal(created.snapshot.rule.id, rule.id);
  assert.equal(created.snapshot.treatment, "standard");
  assert.equal(created.snapshot.taxDisclosure, result.taxDisclosure);
  assert.equal(created.snapshot.taxCharged, true);
  assert.equal(created.snapshot.taxCategory, "general-goods");
  assert.equal(created.snapshot.immutable, true);
  assert.equal(Object.isFrozen(created.snapshot), true);
  assert.equal(Object.isFrozen(created.snapshot.components[0]), true);
});

test("manual estimates, wrong country, missing provenance and invalid dates fail closed", () => {
  assert.equal(makeSnapshot({ countryCode: "IN" }).code, "INDIA_LEGACY_PATH_REQUIRED");
  assert.equal(makeSnapshot({ taxResult: { ...result, currencyCode: "USD" } }).code, "SNAPSHOT_CURRENCY_INVALID");
  assert.equal(makeSnapshot({ taxResult: { ...result, status: "manual_unverified" } }).code, "TAX_RESULT_NOT_ISSUABLE");
  assert.equal(makeSnapshot({ taxResult: { ...result, countryCode: "AE" } }).code, "TAX_RESULT_NOT_ISSUABLE");
  assert.equal(makeSnapshot({ taxResult: { ...result, ruleSnapshot: null } }).code, "RULE_PROVENANCE_REQUIRED");
  assert.equal(makeSnapshot({ invoiceDate: "2026-02-30" }).code, "SNAPSHOT_INVOICE_DATE_INVALID");
  assert.equal(makeSnapshot({ invoiceDate: "2011-01-03" }).code, "RULE_PROVENANCE_REQUIRED");
});

test("component totals and invoice totals must reconcile exactly", () => {
  assert.equal(makeSnapshot({ taxResult: { ...result, totalMinor: 11999 } }).code, "TAX_TOTALS_INVALID");
  assert.equal(makeSnapshot({ taxResult: { ...result, components: [{ ...result.components[0], amountMinor: 1999 }] } }).code, "TAX_COMPONENT_TOTAL_MISMATCH");
});

test("e-invoice preparation never transmits without a configured provider", () => {
  const snapshot = makeSnapshot().snapshot;
  const outcome = prepareEInvoiceSubmission("GB", snapshot);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "EINVOICE_PROVIDER_NOT_CONFIGURED");
  assert.equal(outcome.transmissionEnabled, false);
  assert.equal(prepareEInvoiceSubmission("AE", { countryCode: "GB", immutable: true }).code, "ISSUED_INVOICE_SNAPSHOT_REQUIRED");
});

test("zero-rated and exempt treatment disclosures remain distinct in immutable snapshots", () => {
  const baseZero = {
    ...result, treatment: "zero-rated", taxDisclosure: "Zero-rated supply — 0% tax under the selected verified rule. This is not the same as exempt.",
    taxCharged: false, taxMinor: 0, totalMinor: 10000,
    ruleSnapshot: { ...rule, treatment: "zero-rated", taxCategoryId: "food-category" },
    components: [{ id: "GB-VAT-ZERO", name: "VAT", rateBps: 0, amountMinor: 0 }],
    taxCategory: "food-category",
  };
  const zero = makeSnapshot({ taxResult: baseZero });
  const exempt = makeSnapshot({ taxResult: {
    ...baseZero, treatment: "exempt", taxDisclosure: "Exempt supply — no tax charged under the selected verified rule.",
    ruleSnapshot: { ...rule, treatment: "exempt", taxCategoryId: "medical-category" },
    taxCategory: "medical-category",
  } });
  assert.equal(zero.ok, true);
  assert.equal(exempt.ok, true);
  assert.notEqual(zero.snapshot.taxDisclosure, exempt.snapshot.taxDisclosure);
  assert.equal(zero.snapshot.taxCharged, false);
  assert.equal(exempt.snapshot.taxCharged, false);
  assert.equal(zero.snapshot.taxCategory, "food-category");
  assert.equal(exempt.snapshot.taxCategory, "medical-category");
});

test("snapshot rejects inconsistent zero-charge treatment or missing disclosure", () => {
  assert.equal(makeSnapshot({ taxResult: { ...result, treatment: "exempt", taxCharged: false } }).code, "TAX_TREATMENT_SNAPSHOT_INVALID");
  assert.equal(makeSnapshot({ taxResult: { ...result, taxDisclosure: "", } }).code, "TAX_TREATMENT_SNAPSHOT_INVALID");
  assert.equal(makeSnapshot({ taxResult: { ...result, taxDisclosure: "Exempt supply — no tax charged under the selected verified rule." } }).code, "TAX_TREATMENT_SNAPSHOT_INVALID");
  assert.equal(makeSnapshot({ taxResult: { ...result, ruleSnapshot: { ...rule, treatment: "exempt" } } }).code, "TAX_TREATMENT_RULE_MISMATCH");
  assert.equal(makeSnapshot({ taxResult: { ...result, treatment: "zero-rated", taxCharged: false, taxMinor: 100 } }).code, "TAX_TREATMENT_SNAPSHOT_INVALID");
});


test("Australian GST-free disclosure is distinct from zero-rated and exempt", () => {
  const gstFree = makeSnapshot({ taxResult: {
    ...result, treatment: "gst-free",
    taxDisclosure: "GST-free supply — no GST charged under the selected verified Australian GST-free category. This is distinct from input-taxed supplies.",
    taxCharged: false, taxMinor: 0, totalMinor: 10000,
    ruleSnapshot: { ...rule, treatment: "gst-free", taxCategoryId: "AU_GST_FREE_BASIC_FOOD" },
    taxCategory: "AU_GST_FREE_BASIC_FOOD",
    countryCode: "AU", currencyCode: "AUD",
  } });
  assert.equal(gstFree.ok, true);
  assert.equal(gstFree.snapshot.treatment, "gst-free");
  assert.equal(gstFree.snapshot.taxCharged, false);
});
