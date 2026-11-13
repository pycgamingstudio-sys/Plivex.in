import test from "node:test";
import assert from "node:assert/strict";
import { validateInvoiceAction } from "../../../supabase/functions/_shared/assistant-invoice-validation.mjs";
import { sanitizePublicInvoice } from "../../../supabase/functions/_shared/public-invoice-sanitizer.mjs";

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

test("invoice dates must be real calendar dates", () => {
  const valid = validateInvoiceAction({
    type: "create_invoice",
    payload: {
      ...deterministicAction.payload,
      issue_date: "2024-02-29",
      due_date: "2025-03-01",
    },
  });
  assert.equal(valid.payload.issue_date, "2024-02-29");
  assert.equal(valid.payload.due_date, "2025-03-01");

  const invalidLeapDay = validateInvoiceAction({
    type: "create_invoice",
    payload: { ...deterministicAction.payload, issue_date: "2025-02-29" },
  });
  assert.equal(invalidLeapDay, null);

  const invalidMonthDay = validateInvoiceAction({
    type: "create_invoice",
    payload: { ...deterministicAction.payload, due_date: "2025-13-01" },
  });
  assert.equal(invalidMonthDay, null);

  const trailingGarbage = validateInvoiceAction({
    type: "create_invoice",
    payload: { ...deterministicAction.payload, issue_date: "2024-02-29extra" },
  });
  assert.equal(trailingGarbage, null);
});

test("public invoice sanitizer excludes private snapshot fields and internal identifiers", () => {
  const safe = sanitizePublicInvoice({
    id: "internal-invoice-id",
    workspace_id: "internal-workspace-id",
    number: "INV-100",
    currency: "USD",
    total: 100,
    invoice_snapshot: {
      business: {
        name: "Example Co",
        address: "1 Main St",
        gstin: "GST-123",
        email: "private@example.test",
        phone: "+1-555-0100",
      },
      client: {
        name: "Customer",
        company: "Customer LLC",
        address: "2 Main St",
        email: "customer@example.test",
        phone: "+1-555-0101",
      },
      items: [{
        id: "line-1",
        description: "Service",
        quantity: 1,
        rate: 100,
        gstRate: 5,
        privateMetadata: "must-not-leak",
      }],
      notes: "Public note",
      terms: "Public terms",
      upiId: "private@upi",
      logo: "https://example.test/private-logo.png",
      design: "modern",
    },
    invoice_items: [{ id: "line-1", description: "Service", quantity: 1, rate: 100, secret: "hidden" }],
  });

  assert.equal(safe.number, "INV-100");
  assert.equal(safe.total, 100);
  assert.equal(safe.invoice_snapshot.business.name, "Example Co");
  assert.equal(safe.invoice_snapshot.client.name, "Customer");
  assert.equal(safe.invoice_snapshot.items[0].rate, 100);
  assert.equal(safe.invoice_snapshot.notes, "Public note");
  assert.equal("id" in safe, false);
  assert.equal("workspace_id" in safe, false);
  assert.equal("email" in safe.invoice_snapshot.business, false);
  assert.equal("phone" in safe.invoice_snapshot.business, false);
  assert.equal("email" in safe.invoice_snapshot.client, false);
  assert.equal("upiId" in safe.invoice_snapshot, false);
  assert.equal("logo" in safe.invoice_snapshot, false);
  assert.equal("privateMetadata" in safe.invoice_snapshot.items[0], false);
  assert.equal("secret" in safe.invoice_items[0], false);
});
