import test from "node:test";
import assert from "node:assert/strict";
import { validateGlobalClientAction } from "./assistant-global-client-validation.mjs";

test("validates Global client creation and normalizes optional fields", () => {
  const result = validateGlobalClientAction({
    type: "create_global_client",
    payload: { name: "Yash Traders", email: "billing@example.com", phone: "+1 555 0100", tax_registration_number: "TAX-1" },
  });
  assert.equal(result.payload.name, "Yash Traders");
  assert.equal(result.payload.status, "active");
  assert.equal(result.payload.tax_registration_number, "TAX-1");
  assert.equal(validateGlobalClientAction({ type: "create_global_client", payload: { name: " " } }), null);
  assert.equal(validateGlobalClientAction({ type: "create_global_client", payload: { name: "Yash", email: "not-an-email" } }), null);
});

test("bounds Global client metadata", () => {
  const result = validateGlobalClientAction({
    type: "create_global_client",
    payload: { name: "N".repeat(250), phone: "P".repeat(60), tax_registration_number: "T".repeat(100), notes: "x".repeat(5000) },
  });
  assert.equal(result.payload.name.length, 200);
  assert.equal(result.payload.phone.length, 40);
  assert.equal(result.payload.tax_registration_number.length, 80);
  assert.equal(result.payload.notes.length, 4000);
});
