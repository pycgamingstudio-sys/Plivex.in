import test from "node:test";
import assert from "node:assert/strict";
import { parseBankStatementImport } from "../banking/statement-import.js";

test("statement import parser previews valid rows and preserves source row payloads", () => {
  const result = parseBankStatementImport('Date,Description,Amount,Type,Reference\n2026-11-01,"Customer, Acme",1250,CR,UTR-1\n2026-11-02,Rent,-900,,RENT-2\n');
  assert.equal(result.totalRows, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].sourceRow, 2);
  assert.equal(result.rows[0].rawRow.description, "Customer, Acme");
  assert.equal(result.rows[1].direction, "debit");
  assert.equal(result.rows[1].amount, 900);
});

test("invalid statement rows are reported instead of silently dropped", () => {
  const result = parseBankStatementImport("Date,Description,Amount\n2026-11-01,Valid,100\nnot-a-date,Missing,200\n2026-11-03,,300\n2026-11-04,Bad amount,abc\n");
  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 3);
  assert.deepEqual(result.errors.map((row) => row.sourceRow), [3, 4, 5]);
  assert.equal(result.errors[0].rawRow.amount, "200");
});

test("statement parser rejects malformed quoted CSV and impossible dates", () => {
  assert.throws(() => parseBankStatementImport('Date,Description,Amount\n2026-11-01,"unterminated,10'));
  const result = parseBankStatementImport("Date,Description,Amount\n2026-02-30,Invalid date,10\n");
  assert.match(result.errors[0].reason, /valid ISO date/);
});

test("statement parser accepts one populated side in debit-credit bank exports", () => {
  const result = parseBankStatementImport("Date,Narration,Credit Amount,Debit Amount\n2026-11-01,Receipt,1250,\n2026-11-02,Rent,,900\n");
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.rows.map((row) => [row.direction, row.amount]), [["credit", 1250], ["debit", 900]]);
});


test("statement parser detects repeated bank references without dropping them silently", () => {
  const result = parseBankStatementImport("Date,Description,Amount,Type,Reference\n2026-11-01,Receipt,100,CR,UTR-1\n2026-11-01,Receipt duplicate,100,CR,UTR-1\n");
  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].sourceRow, 3);
  assert.match(result.errors[0].reason, /Duplicate bank reference/);
});
