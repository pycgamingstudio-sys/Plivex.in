import test from "node:test";
import assert from "node:assert/strict";
import { validateGlobalInvoicePaymentAction, majorToMinorUnits } from "./assistant-global-payment-validation.mjs";

const valid = {
  type: "record_global_invoice_payment",
  payload: {
    invoice_id: "123e4567-e89b-42d3-a456-426614174000",
    amount: 125.50, currency_code: "USD", payment_date: "2026-11-19",
    method: "Bank transfer", reference: "UTR-123", notes: "Part payment",
  },
};

test("validates Global payment identity, currency, amount and date", () => {
  const result = validateGlobalInvoicePaymentAction(valid);
  assert.equal(result.payload.amount, 125.5);
  assert.equal(result.payload.currency_code, "USD");
  assert.equal(validateGlobalInvoicePaymentAction({ ...valid, payload: { ...valid.payload, payment_date: "2026-02-30" } }), null);
  assert.equal(validateGlobalInvoicePaymentAction({ ...valid, payload: { ...valid.payload, invoice_id: "not-a-uuid" } }), null);
  assert.equal(validateGlobalInvoicePaymentAction({ ...valid, payload: { ...valid.payload, amount: 0 } }), null);
});

test("converts major units using currency-specific minor-unit precision", () => {
  assert.equal(majorToMinorUnits(125.5, "USD"), 12550);
  assert.equal(majorToMinorUnits(125.5, "INR"), 12550);
  assert.equal(majorToMinorUnits(125, "JPY"), 125);
  assert.equal(majorToMinorUnits(1.234, "KWD"), 1234);
  assert.equal(majorToMinorUnits(1.234, "USD"), null);
  assert.equal(majorToMinorUnits(-1, "USD"), null);
  assert.equal(majorToMinorUnits(10, "XXX"), null);
});

test("bounds optional payment metadata", () => {
  const result = validateGlobalInvoicePaymentAction({
    ...valid, payload: { ...valid.payload, method: "x".repeat(100), reference: "y".repeat(200), notes: "z".repeat(1200) },
  });
  assert.equal(result.payload.method.length, 80);
  assert.equal(result.payload.reference.length, 160);
  assert.equal(result.payload.notes.length, 1000);
});
