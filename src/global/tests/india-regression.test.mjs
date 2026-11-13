import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { formatMoney, amountInWords } from "../../lib/currency.js";
import { formatCurrency } from "../localization/number-format.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// Independent arithmetic oracle for the documented India invoice contract.
// These tests do not execute PostgreSQL; SQL integration/rollback is separately identified below.
function calculateInvoice(items, { discountType = "percent", discount = 0, taxMode = "split", taxRate = 0 } = {}) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.rate, 0);
  const discountValue = discountType === "flat"
    ? Math.min(discount, subtotal)
    : subtotal * Math.min(discount, 100) / 100;
  const taxable = Math.max(0, subtotal - discountValue);
  const tax = items.reduce((sum, item) => {
    const lineSubtotal = item.quantity * item.rate;
    const lineDiscount = subtotal > 0 ? lineSubtotal / subtotal * discountValue : 0;
    return sum + (lineSubtotal - lineDiscount) * (item.gstRate || taxRate) / 100;
  }, 0);
  return {
    subtotal: round2(subtotal),
    discount: round2(discountValue),
    taxable: round2(taxable),
    tax: round2(tax),
    cgst: taxMode === "split" ? round2(tax / 2) : 0,
    sgst: taxMode === "split" ? round2(tax / 2) : 0,
    igst: taxMode === "igst" ? round2(tax) : 0,
    total: round2(taxable + tax),
  };
}

test("India invoice calculation oracle covers subtotal, percent/flat discount, tax and rounding", () => {
  const items = [{ quantity: 2, rate: 100, gstRate: 18 }, { quantity: 1, rate: 50, gstRate: 5 }];
  assert.deepEqual(calculateInvoice(items, { discountType: "percent", discount: 10 }), {
    subtotal: 250, discount: 25, taxable: 225, tax: 34.65,
    cgst: 17.33, sgst: 17.33, igst: 0, total: 259.65,
  });
  assert.deepEqual(calculateInvoice(items, { discountType: "flat", discount: 30, taxMode: "igst" }), {
    subtotal: 250, discount: 30, taxable: 220, tax: 33.88,
    cgst: 0, sgst: 0, igst: 33.88, total: 253.88,
  });
  assert.equal(calculateInvoice([{ quantity: 1, rate: 0.05, gstRate: 5 }]).total, 0.05);
  assert.equal(calculateInvoice([{ quantity: 1, rate: 100, gstRate: 18 }], { discountType: "flat", discount: 500 }).total, 0);
});

test("India CGST and SGST split equally; IGST is exclusive", () => {
  const items = [{ quantity: 1, rate: 1000, gstRate: 18 }];
  const split = calculateInvoice(items, { taxMode: "split" });
  assert.equal(split.cgst, 90);
  assert.equal(split.sgst, 90);
  assert.equal(split.igst, 0);
  const interstate = calculateInvoice(items, { taxMode: "igst" });
  assert.equal(interstate.cgst, 0);
  assert.equal(interstate.sgst, 0);
  assert.equal(interstate.igst, 180);
  assert.equal(interstate.total, split.total);
});

test("INR formatter and amount-in-words preserve Indian currency defaults", () => {
  assert.equal(formatMoney(1234.5), "₹1,234.50");
  assert.equal(formatCurrency(1234.5, { currencyCode: "INR", locale: "en-IN" }), "₹1,234.50");
  assert.equal(amountInWords(1234.5), "One Thousand Two Hundred Thirty Four Rupees and Fifty Paise Only");
  assert.equal(amountInWords(100), "One Hundred Rupees Only");
});

test("invoice RPC source contract covers create, edit, totals, GST, status, and atomic stock writes", async () => {
  const sql = await read("../../../supabase/migrations/202610270001_h1_invoice_rpcs.sql");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.save_invoice/);
  assert.match(sql, /INSERT INTO public\.invoice_counters/);
  assert.match(sql, /INSERT INTO public\.invoices/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /DELETE FROM public\.invoice_items WHERE invoice_id = _inv\.id/);
  assert.match(sql, /_subtotal := _subtotal \+/);
  assert.match(sql, /_dtype = 'percent'[\s\S]*_subtotal \* LEAST\(_disc,100\) \/ 100/);
  assert.match(sql, /_tax := _tax \+/);
  assert.match(sql, /cgst = CASE WHEN _mode = 'split' THEN _tax \/ 2 ELSE 0 END/);
  assert.match(sql, /sgst = CASE WHEN _mode = 'split' THEN _tax \/ 2 ELSE 0 END/);
  assert.match(sql, /igst = CASE WHEN _mode = 'igst' THEN _tax ELSE 0 END/);
  assert.match(sql, /total = GREATEST\(0, _taxable \+ _tax\)/);
  assert.match(sql, /IF NOT _inv\.is_draft AND NOT _inv\.stock_applied THEN/);
  assert.match(sql, /UPDATE public\.stock s SET quantity = GREATEST\(0, s\.quantity - q\.qty\)/);
  assert.match(sql, /UPDATE public\.invoices SET stock_applied = true/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.cancel_invoice/);
  assert.match(sql, /status = 'Cancelled'/);
});

test("invoice API routes creation and status transitions through the authenticated RPC contract", async () => {
  const save = await read("../../../supabase/functions/save-invoice/index.ts");
  const status = await read("../../../supabase/functions/set-invoice-status/index.ts");
  assert.match(save, /Authorization/);
  assert.match(save, /db\.rpc\("save_invoice"/);
  assert.match(save, /invoiceId = body\.invoiceId \?\? body\.id \?\? null/);
  assert.match(status, /\["Pending", "Paid", "Cancelled"\]/);
  assert.match(status, /db\.rpc\("cancel_invoice"/);
  assert.match(status, /db\.rpc\("save_invoice"/);
});

test("quotation persistence mapper retains India quotation fields and status", async () => {
  const stores = await read("../../lib/stores.js");
  assert.match(stores, /quotations:\s*\{/);
  assert.match(stores, /clientName: str\(r\.client_name\)/);
  assert.match(stores, /total: num\(r\.total\)/);
  assert.match(stores, /taxRate: num\(r\.tax_rate\)/);
  assert.match(stores, /status: i\.status === "sent" \? "sent" : "draft"/);
  assert.match(stores, /items: Array\.isArray\(i\.items\) \? i\.items : \[\]/);
  assert.match(stores, /workspaceRecords", \{ table: key, action: "create"/);
});

test("inventory deduction remains server-side and invoice deletion is replaced by cancellation", async () => {
  const stores = await read("../../lib/stores.js");
  const sql = await read("../../../supabase/migrations/202610270001_h1_invoice_rpcs.sql");
  assert.match(stores, /Stock is now reduced by the server when an invoice is saved/);
  assert.match(stores, /export function deductStockForInvoice\(\) \{ return false; \}/);
  assert.match(sql, /IF NOT _inv\.is_draft AND NOT _inv\.stock_applied THEN/);
  assert.match(sql, /UPDATE public\.stock s SET quantity = GREATEST\(0, s\.quantity - q\.qty\)/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.cancel_invoice/);
  assert.match(sql, /SET status = 'Cancelled'/);
});

test("existing India membership regression test remains present and unchanged in scope", async () => {
  const membership = await read("../../components/team/tests/teamResponse.test.mjs");
  assert.match(membership, /test\(/);
  assert.match(membership, /workspace/);
  assert.match(membership, /permission/i);
});


test("Supabase migration versions are unique and subscription priority has a forward convergence migration", async () => {
  const migrations = await readdir(new URL("../../../supabase/migrations/", import.meta.url));
  const versioned = migrations
    .filter((name) => /^\d{12}_.+\.sql$/.test(name))
    .map((name) => ({ name, version: name.slice(0, 12) }));
  const versions = versioned.map(({ version }) => version);
  assert.equal(new Set(versions).size, versions.length, "migration version timestamps must be unique");
  assert.ok(migrations.includes("202610280004_fix_overlapping_subscription_tier_priority.sql"));
  assert.ok(!migrations.includes("202610280004_prioritize_effective_subscription.sql"));
  assert.ok(migrations.includes("202611130004_converge_effective_subscription_priority.sql"));

  const convergence = await read("../../../supabase/migrations/202611130004_converge_effective_subscription_priority.sql");
  assert.match(convergence, /Unexpected current_plan ordering after 202610280004/);
  assert.match(convergence, /Unexpected get_access_status expiry query after 202610280004/);
  assert.match(convergence, /Unexpected get_access_status startedAt expression after 202610280004/);
  assert.match(convergence, /WHEN 'pro' THEN 2 WHEN 'basic' THEN 1/);
});
