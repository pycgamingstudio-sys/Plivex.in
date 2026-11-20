import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261120120000_unified_workspace_commercial_invoice_issuance.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../../../supabase/functions/save-invoice/index.ts", import.meta.url), "utf8");
const home = readFileSync(new URL("../../pages/Home.jsx", import.meta.url), "utf8");
const stores = readFileSync(new URL("../../lib/stores.js", import.meta.url), "utf8");
const sharing = readFileSync(new URL("../../lib/invoiceShare.js", import.meta.url), "utf8");

test("Main Workspace commercial issuance is limited to the six non-India country/currency pairs", () => {
  assert.match(migration, /v_settings\.country_code not in \('GB','US','AE','CA','AU','SG'\)/);
  for (const [country, currency] of [["GB","GBP"],["US","USD"],["AE","AED"],["CA","CAD"],["AU","AUD"],["SG","SGD"]]) {
    assert.match(migration, new RegExp(`when '${country}' then '${currency}'`));
  }
  assert.doesNotMatch(migration, /v_settings\.country_code not in \([^)]*'IN'/);
});

test("Issuance requires an authenticated admin/manager, seller identity, customer, dates and explicit no-tax attestation", () => {
  assert.match(migration, /v_role not in \('admin','manager'\)/);
  assert.match(migration, /v_profile\.name/);
  assert.match(migration, /v_profile\.address/);
  assert.match(migration, /client_name/);
  assert.match(migration, /noTaxConfirmed/);
  assert.match(migration, /Due date cannot be earlier than the issue date/);
});

test("Commercial issuance is atomic, idempotent and assigns a server-side country/year invoice number", () => {
  assert.match(migration, /public\.save_invoice\(/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /issue_request_key/);
  assert.match(migration, /primary key \(workspace_id, invoice_year\)/);
  assert.match(migration, /'INV-'\|\|v_settings\.country_code/);
  assert.match(migration, /'documentStatus','issued'/);
});

test("Issued invoice header and lines cannot be edited or deleted", () => {
  assert.match(migration, /guard_issued_workspace_invoice/);
  assert.match(migration, /Issued invoice content is immutable/);
  assert.match(migration, /guard_issued_workspace_invoice_items/);
  assert.match(migration, /Issued invoice lines are immutable/);
});

test("Edge Function issues only a server-validated commercial invoice and keeps tax invoices fail-closed", () => {
  assert.match(edge, /body\?\.issue_invoice === true/);
  assert.match(edge, /calculation\?\.status !== "not_applicable"/);
  assert.match(edge, /save_and_issue_commercial_invoice/);
  assert.match(edge, /Tax invoices remain gated/);
});

test("Main Workspace renders issued PDF state only after server confirms issuance", () => {
  assert.match(stores, /issue_invoice: isGlobalWorkspaceInvoice && issueInvoice/);
  assert.match(stores, /issue_idempotency_key/);
  assert.match(home, /globalTaxCalculation\?\.status === "not_applicable"/);
  assert.match(home, /const issuedInvoice = saved\.issued/);
});

test("Unified invoice sharing uses the canonical public invoice ledger for every country", () => {
  assert.match(sharing, /invoke\("invoice-share"/);
  assert.doesNotMatch(sharing, /global-invoice-share/);
});
