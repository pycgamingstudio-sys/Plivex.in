import test from "node:test";
import assert from "node:assert/strict";
import { buildGstr1Draft } from "../tax/gstr1-draft.js";

const base = {
  number: "INV-100",
  issueDate: "2026-04-10",
  status: "Pending",
  isDraft: false,
  subtotal: 1000,
  discount: 10,
  discountType: "percent",
  total: 1062,
  invoiceSnapshot: {
    business: { gstin: "09AAACB1234C1Z5" },
    client: { name: "Registered buyer", gstin: "09AAACB1234C1Z5" },
    taxMode: "split",
    items: [{ description: "Consulting", quantity: 1, rate: 1000, gstRate: 18, hsnSac: "9983" }],
  },
  items: [{ description: "Consulting", quantity: 1, rate: 1000, gstRate: 18, hsnSac: "9983" }],
};

test("GSTR-1 draft groups registered sales by GST rate and allocates discounts", () => {
  const result = buildGstr1Draft([base], { from: "2026-04-01", to: "2026-04-30" });
  assert.equal(result.invoiceCount, 1);
  assert.equal(result.b2b.length, 1);
  assert.equal(result.b2b[0].recipientGstin, "09AAACB1234C1Z5");
  assert.equal(result.b2b[0].taxableValue, 900);
  assert.equal(result.b2b[0].cgstAmount, 81);
  assert.equal(result.b2b[0].sgstAmount, 81);
  assert.equal(result.hsn[0].hsnSac, "9983");
});

test("GSTR-1 draft routes unregistered sales to B2C and handles IGST", () => {
  const invoice = {
    ...base,
    invoiceSnapshot: { ...base.invoiceSnapshot, client: { name: "Retail customer" }, taxMode: "igst" },
  };
  const result = buildGstr1Draft([invoice]);
  assert.equal(result.b2c.length, 1);
  assert.equal(result.b2b.length, 0);
  assert.equal(result.b2c[0].igstAmount, 162);
  assert.ok(result.warnings.some((warning) => warning.includes("Place of supply")));
});

test("GSTR-1 draft excludes drafts, cancelled records, out-of-range and malformed GSTINs", () => {
  const cancelled = { ...base, number: "INV-101", status: "cancelled" };
  const draft = { ...base, number: "INV-102", isDraft: true };
  const badBuyer = {
    ...base,
    number: "INV-103",
    invoiceSnapshot: { ...base.invoiceSnapshot, client: { name: "Bad GSTIN", gstin: "99AAACB1234C1Z5" } },
  };
  const result = buildGstr1Draft([base, cancelled, draft, badBuyer], { from: "2026-04-01", to: "2026-04-30" });
  assert.equal(result.invoiceCount, 1);
  assert.equal(result.b2b.length, 1);
  assert.equal(result.b2c.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("failed format validation")));
});

test("GSTR-1 draft warns when seller GSTIN or HSN/SAC is missing", () => {
  const invoice = {
    ...base,
    invoiceSnapshot: {
      ...base.invoiceSnapshot,
      business: {},
      client: { name: "Retail customer" },
      items: [{ description: "Unclassified service", quantity: 1, rate: 1000, gstRate: 18 }],
    },
    items: [{ description: "Unclassified service", quantity: 1, rate: 1000, gstRate: 18 }],
  };
  const result = buildGstr1Draft([invoice]);
  assert.ok(result.warnings.some((warning) => warning.includes("Seller GSTIN")));
  assert.ok(result.warnings.some((warning) => warning.includes("HSN/SAC")));
  assert.equal(result.hsn[0].hsnSac, "NOT_RECORDED");
});
