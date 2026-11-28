import test from "node:test";
import assert from "node:assert/strict";
import { validateGlobalSupplierAction } from "./assistant-global-supplier-validation.mjs";

test("validates and normalizes supplier details", () => {
  assert.deepEqual(validateGlobalSupplierAction({ type: "create_global_supplier", payload: {
    name: "  Acme Supply  ", email: " SALES@ACME.COM ", phone: "+91 98765 43210", tax_registration_number: "GST-123"
  }}), { type: "create_global_supplier", payload: {
    name: "Acme Supply", email: "sales@acme.com", phone: "+91 98765 43210", tax_registration_number: "GST-123"
  }});
});

test("rejects missing name and malformed email", () => {
  assert.equal(validateGlobalSupplierAction({ type: "create_global_supplier", payload: { email: "bad" } }), null);
  assert.equal(validateGlobalSupplierAction({ type: "create_global_supplier", payload: { name: "Acme", email: "bad" } }), null);
});

test("bounds optional supplier fields", () => {
  const result = validateGlobalSupplierAction({ type: "create_global_supplier", payload: {
    name: "A".repeat(250), email: "", phone: "1".repeat(60), tax_registration_number: "T".repeat(100)
  }});
  assert.equal(result.payload.name.length, 200);
  assert.equal(result.payload.phone.length, 40);
  assert.equal(result.payload.tax_registration_number.length, 80);
});
