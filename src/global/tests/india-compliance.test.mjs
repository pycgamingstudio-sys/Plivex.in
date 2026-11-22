import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIndiaCompliance, buildIndiaComplianceDetailsExport } from "../tax/india-compliance.js";

test("validates and normalizes manual IRN and E-Way Bill references", () => {
  const result = normalizeIndiaCompliance({
    irn:"a".repeat(64), ack_number:"123456789012345", ack_date:"2026-11-22",
    eway_bill_number:"123456789012", eway_bill_date:"2026-11-22",
    eway_bill_valid_until:"2026-11-23", transport_mode:"road",
    vehicle_number:"UP32AB1234", distance_km:"120",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.irn, "A".repeat(64));
  assert.equal(result.value.distance_km, 120);
});

test("rejects malformed manual government references and invalid dates", () => {
  assert.equal(normalizeIndiaCompliance({ irn:"123" }).ok, false);
  assert.equal(normalizeIndiaCompliance({ ack_number:"123" }).ok, false);
  assert.equal(normalizeIndiaCompliance({ eway_bill_number:"123" }).ok, false);
  assert.equal(normalizeIndiaCompliance({ ack_date:"2026-02-30" }).ok, false);
});

test("export is clearly labelled as manual details, not an official API payload", () => {
  const payload = buildIndiaComplianceDetailsExport({
    invoice:{ invoice_number:"INV-1", currency_code:"INR", total_minor:11800 },
    items:[{ description:"Service", quantity:1, unit_price_minor:10000 }],
    compliance:{ irn:"A".repeat(64) }, exportType:"e_invoice",
  });
  assert.equal(payload.document.invoice_number,"INV-1");
  assert.equal(payload.india_compliance.irn,"A".repeat(64));
  assert.match(payload.notice,/not a government portal submission/i);
});
