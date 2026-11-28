import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261128123000_main_workspace_invoice_journal_posting.sql", import.meta.url), "utf8");

test("invoice issuance posts one immutable, balanced journal with receivable, revenue and tax payable", () => {
  assert.match(migration, /create or replace function public\.post_main_workspace_invoice_journal/);
  assert.match(migration, /security definer[\s\S]*set search_path=pg_catalog,public/);
  assert.match(migration, /new\.is_draft is distinct from false/);
  assert.match(migration, /old\.is_draft is distinct from true/);
  assert.match(migration, /code='1100'[\s\S]*account_type='asset'/);
  assert.match(migration, /code='4000'[\s\S]*account_type='revenue'/);
  assert.match(migration, /code='2100'[\s\S]*account_type='liability'/);
  assert.match(migration, /v_total-v_tax/);
  assert.match(migration, /source_type='invoice_issued'/);
  assert.match(migration, /request_fingerprint/);
  assert.match(migration, /accounting\.invoice_journal_posted/);
  assert.match(migration, /after insert or update of is_draft on public\.invoices/);
});

test("invoice journal posting is idempotent and fails closed when the chart of accounts is incomplete", () => {
  assert.match(migration, /journal_entries_invoice_source_unique/);
  assert.match(migration, /md5\('plivex:invoice-issued:'/);
  assert.match(migration, /invoice_journal_payload_conflict/);
  assert.match(migration, /invoice_ledger_chart_account_missing/);
  assert.match(migration, /invoice_ledger_actor_required/);
});
