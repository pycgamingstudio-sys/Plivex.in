import test from "node:test";
import assert from "node:assert/strict";
import { parseBankStatementCsv, categorizeBankTransaction, suggestReconciliationMatches } from "../banking/reconciliation-engine.js";
import { readFile } from "node:fs/promises";

test("bank CSV parser handles quoted commas, UTR references and credit/debit columns", () => {
  const csv = 'Date,Narration,Credit Amount,Debit Amount,UTR Reference\n2026-11-01,"Customer, Acme invoice",1250,,123456789012\n2026-11-02,"Rent payment",,900,RENT-22\n';
  const rows = parseBankStatementCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, 1250);
  assert.equal(rows[0].direction, "credit");
  assert.equal(rows[0].utr, "123456789012");
  assert.equal(rows[1].amount, -900);
  assert.equal(rows[1].direction, "debit");
  assert.equal(rows[1].category, "Rent");
});

test("bank CSV parser accepts signed Amount (INR) and DR/CR type columns", () => {
  const csv = 'Transaction Date,Description,Amount (INR),Dr/Cr\n2026-11-03,"Internet bill",-450,DR\n2026-11-04,"Customer collection",1200,CR\n';
  const rows = parseBankStatementCsv(csv);
  assert.deepEqual(rows.map((row) => row.amount), [-450, 1200]);
  assert.equal(rows[0].category, "Utilities");
  assert.equal(rows[1].category, "Customer receipt");
});

test("automatic transaction categorization is transparent and leaves unknown narration unclassified", () => {
  assert.deepEqual(categorizeBankTransaction({ narration: "NEFT RENT NOV", amount: -1000 }), {
    category: "Rent", categoryConfidence: 0.85, categorySource: "description_rule",
  });
  assert.equal(categorizeBankTransaction({ narration: "XYZ/00011", amount: 500 }).category, "Unclassified receipt");
});

test("reconciliation produces suggestions without mutating invoices or expenses", () => {
  const invoice = { id: "inv-1", number: "INV-001", clientName: "Acme Limited", total: 1250, status: "Pending", utrReference: "123456789012" };
  const expense = { id: "exp-1", vendor: "City Rent", amount: 900, status: "Unpaid" };
  const txs = [
    { id: "a", narration: "Acme Limited payment", amount: 1250, utr: "123456789012" },
    { id: "b", narration: "City Rent monthly", amount: -900, utr: "" },
  ];
  const result = suggestReconciliationMatches(txs, [invoice], [expense]);
  assert.equal(result.matched, 2);
  assert.equal(result.entries[0].matchedRecordType, "invoice");
  assert.equal(result.entries[0].matchStatus, "SUGGESTED");
  assert.equal(result.entries[1].matchedRecordType, "expense");
  assert.equal(result.entries[1].matchStatus, "SUGGESTED");
  assert.equal(result.totalReconciled, 0);
  assert.equal(invoice.status, "Pending");
  assert.equal(expense.status, "Unpaid");
});

test("ambiguous candidates and duplicate statement rows are not auto-applied", () => {
  const invoices = [
    { id: "inv-1", number: "INV-1", clientName: "Acme", total: 500, status: "Pending" },
    { id: "inv-2", number: "INV-2", clientName: "Acme", total: 500, status: "Pending" },
  ];
  const txs = [
    { id: "a", narration: "Acme", amount: 500, utr: "" },
    { id: "b", narration: "Acme", amount: 500, utr: "" },
  ];
  const result = suggestReconciliationMatches(txs, invoices, []);
  assert.equal(result.entries[0].matchStatus, "REVIEW_REQUIRED");
  assert.equal(result.entries[1].matchStatus, "REVIEW_REQUIRED");
  assert.equal(result.matched, 0);
});

test("reconciliation writes are isolated to the explicit apply action", async () => {
  const source = await readFile(new URL("../../lib/reconciliation.js", import.meta.url), "utf8");
  assert.match(source, /export function applyReconciliationMatches/);
  assert.match(source, /saveList\(KEYS\.history, invoices\)/);
  assert.match(source, /saveList\(KEYS\.expenses, expenses\)/);
  assert.doesNotMatch(source, /export function reconcileTransactions\([^}]*saveList/);
});


test("exact UTR and amount outrank fuzzy same-amount candidates and prevent duplicate invoice matching", () => {
  const invoices = [
    { id: "inv-exact", number: "INV-EXACT", clientName: "Different narration", total: 800, status: "Pending", utrReference: "123456789012" },
    { id: "inv-fuzzy", number: "INV-FUZZY", clientName: "Acme", total: 800, status: "Pending" },
  ];
  const txs = [
    { id: "a", narration: "Acme", amount: 800, utr: "123456789012" },
    { id: "b", narration: "Acme", amount: 800, utr: "123456789012" },
  ];
  const result = suggestReconciliationMatches(txs, invoices, []);
  assert.equal(result.entries[0].matchedRecordId, "inv-exact");
  assert.equal(result.entries[0].matchStatus, "SUGGESTED");
  assert.equal(result.entries[1].matchStatus, "UNMATCHED");
});


test("payee phrase inside a longer bank narration remains a strong reconciliation match", () => {
  const expense = { id: "exp-phrase", vendor: "City Rent", amount: 900, status: "Unpaid" };
  const result = suggestReconciliationMatches(
    [{ id: "rent", narration: "City Rent monthly", amount: -900, utr: "" }],
    [],
    [expense],
  );
  assert.equal(result.entries[0].matchStatus, "SUGGESTED");
  assert.equal(result.entries[0].matchedRecordId, "exp-phrase");
});
