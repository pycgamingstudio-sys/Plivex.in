import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/202611150011_global_invoice_issuance_and_refunds.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../../../supabase/functions/global-invoices/index.ts", import.meta.url), "utf8");

test("Global invoice issuance is server-authoritative and initially GB-only", () => {
  assert.match(migration, /v_workspace\.country_code <> 'GB'/);
  assert.match(migration, /v_workspace\.currency_code <> 'GBP'/);
  assert.match(migration, /upper\(coalesce\(v_profile\.tax_registration_type,''\)\) <> 'VAT'/);
  assert.match(migration, /tax_category','standard-rated'/);
  assert.match(migration, /'rate_bps',2000/);
  assert.match(migration, /round\(v_line_base::numeric \* 2000 \/ 10000\)/);
  assert.match(migration, /round\(v_line_base::numeric \* 2000 \/ 12000\)/);
});

test("Official invoice numbers are serialized and unique per workspace/year", () => {
  assert.match(migration, /create table if not exists global\.invoice_number_sequences/);
  assert.match(migration, /primary key \(workspace_id, invoice_year\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /on conflict\(workspace_id,invoice_year\) do update/);
  assert.match(migration, /INV-GB-/);
});

test("Issued invoice headers, lines, and refund ledger are immutable", () => {
  assert.match(migration, /global\.guard_issued_invoice_immutability/);
  assert.match(migration, /Issued invoice content and tax snapshot are immutable/);
  assert.match(migration, /global\.guard_issued_invoice_items/);
  assert.match(migration, /Issued invoice lines are immutable/);
  assert.match(migration, /global\.guard_invoice_refund_append_only/);
});

test("Refund and reconciliation RPCs are service-role only", () => {
  assert.match(migration, /create table if not exists global\.invoice_refunds/);
  assert.match(migration, /amount_refunded_minor/);
  assert.match(migration, /global_record_invoice_refund/);
  assert.match(migration, /global_list_invoice_reconciliation/);
  assert.match(migration, /grant execute on function public\.global_issue_invoice\(uuid,uuid,uuid,jsonb,uuid\) to service_role/);
  assert.match(migration, /grant execute on function public\.global_record_invoice_refund\(uuid,uuid,uuid,bigint,text,date,text,text,text,uuid\) to service_role/);
  assert.match(migration, /grant execute on function public\.global_list_invoice_reconciliation\(uuid,uuid,integer\) to service_role/);
});

test("Global invoice Edge Function exposes issue, refund and reconciliation actions", () => {
  assert.match(edge, /body\.action === "issue"/);
  assert.match(edge, /global_issue_invoice/);
  assert.match(edge, /body\.action === "record_refund"/);
  assert.match(edge, /global_record_invoice_refund/);
  assert.match(edge, /body\.action === "list_reconciliation"/);
  assert.match(edge, /global_list_invoice_reconciliation/);
});
