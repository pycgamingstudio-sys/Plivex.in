import test from "node:test";
import assert from "node:assert/strict";
import { validateInvoiceAction } from "../../../supabase/functions/_shared/assistant-invoice-validation.mjs";

const deterministicAction = {
  type: "create_invoice",
  payload: {
    client_name: "Northwind Ltd",
    business_name: "Plivex Demo",
    client_email: "accounts@northwind.example",
    currency: "USD",
    tax_mode: "igst",
    tax_rate: 12,
    discount_type: "flat",
    discount: 25,
    notes: "Deterministic invoice",
    terms: "Payment due in 15 days",
    items: [{ description: "Consulting", quantity: 2, rate: 150, gst_rate: 5 }],
    invoice_snapshot: {
      business: { name: "Plivex Demo", email: "billing@plivex.example" },
      client: { name: "Untrusted name", company: "Northwind" },
      items: [{ id: "det-line-1", rate: 99999, gstRate: 99 }],
      currency: "INR",
    },
  },
};

const modelGeneratedAction = {
  type: "create_invoice",
  payload: {
    client_name: "Acme LLC",
    currency: "CAD",
    tax_mode: "split",
    tax_rate: 18,
    discount_type: "percent",
    discount: 10,
    items: [
      { description: "Design", quantity: 3, rate: 80.5, gst_rate: 13 },
      { description: "Support", quantity: 1, rate: 40, gst_rate: 0 },
    ],
    invoice_snapshot: {
      currency: "EUR",
      items: [{ id: "model-line-1" }, { id: "model-line-2" }],
    },
  },
};

for (const [label, input, expected] of [
  ["deterministic", deterministicAction, {
    client: "Northwind Ltd", currency: "USD", rate: 150, gstRate: 5,
    taxRate: 12, taxMode: "igst", discountType: "flat", discount: 25,
  }],
  ["model-generated", modelGeneratedAction, {
    client: "Acme LLC", currency: "CAD", rate: 80.5, gstRate: 13,
    taxRate: 18, taxMode: "split", discountType: "percent", discount: 10,
  }],
]) {
  test(`${label} invoice action runtime validation preserves normalized snapshot`, () => {
    const result = validateInvoiceAction(input);
    assert.ok(result);
    const payload = result.payload;
    const snapshot = payload.invoice_snapshot;
    assert.equal(payload.client_name, expected.client);
    assert.equal(payload.currency, expected.currency);
    assert.equal(snapshot.client.name, expected.client);
    assert.equal(snapshot.currency, expected.currency);
    assert.equal(snapshot.items[0].rate, expected.rate);
    assert.equal(snapshot.items[0].gstRate, expected.gstRate);
    assert.equal(snapshot.taxRate, expected.taxRate);
    assert.equal(snapshot.taxMode, expected.taxMode);
    assert.equal(snapshot.discountType, expected.discountType);
    assert.equal(snapshot.discount, expected.discount);
    assert.equal(snapshot.items.length, payload.items.length);
    assert.equal(payload.is_draft, true);
  });
}

test("rejects unsupported currency and invalid invoice item values", () => {
  assert.equal(validateInvoiceAction({
    type: "create_invoice",
    payload: { ...deterministicAction.payload, currency: "XYZ" },
  }), null);
  assert.equal(validateInvoiceAction({
    type: "create_invoice",
    payload: { ...deterministicAction.payload, items: [{ description: "Bad", quantity: 0, rate: -1 }] },
  }), null);
});

test("snapshot metadata cannot override validated currency, rates or GST", () => {
  const result = validateInvoiceAction(deterministicAction);
  assert.equal(result.payload.invoice_snapshot.currency, "USD");
  assert.equal(result.payload.invoice_snapshot.items[0].rate, 150);
  assert.equal(result.payload.invoice_snapshot.items[0].gstRate, 5);
  assert.equal(result.payload.invoice_snapshot.business.name, "Plivex Demo");
});
