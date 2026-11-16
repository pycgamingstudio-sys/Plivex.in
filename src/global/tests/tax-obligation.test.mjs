import test from "node:test";
import assert from "node:assert/strict";
import { assessTaxCollectionObligation } from "../tax/tax-obligation.js";
const registration = {
  status: "registered", registrationNumber: "GB123", effectiveFrom: "2026-01-01",
  confirmedByBusiness: true,
};
test("requires business-confirmed effective registration", () => {
  assert.equal(assessTaxCollectionObligation({ countryCode: "GB", invoiceDate: "2026-11-16", registration }).ok, true);
  assert.equal(assessTaxCollectionObligation({ countryCode: "GB", invoiceDate: "2025-12-31", registration }).code, "REGISTRATION_NOT_CONFIRMED_OR_EFFECTIVE");
});
test("US and Canada require explicit jurisdiction and collection-obligation evidence", () => {
  const us = { ...registration, jurisdictionId: "US-CA", collectionObligationConfirmed: true, obligationEvidenceReference: "case-1" };
  assert.equal(assessTaxCollectionObligation({ countryCode: "US", jurisdictionId: "US-CA", invoiceDate: "2026-11-16", registration: us }).ok, true);
  assert.equal(assessTaxCollectionObligation({ countryCode: "US", invoiceDate: "2026-11-16", registration: us }).code, "JURISDICTION_OR_COLLECTION_OBLIGATION_UNVERIFIED");
});
test("does not infer registration for unsupported or India legacy path", () => {
  assert.equal(assessTaxCollectionObligation({ countryCode: "IN" }).code, "INDIA_LEGACY_ADAPTER_REQUIRED");
  assert.equal(assessTaxCollectionObligation({ countryCode: "ZZ" }).code, "UNSUPPORTED_COUNTRY");
});
