import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/202611150011_global_invoice_issuance_and_refunds.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../../../supabase/functions/global-invoices/index.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../../components/global/GlobalInvoicesPanel.jsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../../pages/Home.jsx", import.meta.url), "utf8");
const history = readFileSync(new URL("../../pages/InvoiceHistory.jsx", import.meta.url), "utf8");
const stores = readFileSync(new URL("../../lib/stores.js", import.meta.url), "utf8");

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
  assert.match(migration, /global\.guard_invoice_payment_append_only/);
  assert.match(migration, /issuance_request_fingerprint/);
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

test("Global invoice workspace exposes PDF, WhatsApp/email share, payment, refund and reconciliation", () => {
  assert.match(panel, /new jsPDF\(\{ orientation:"portrait", unit:"mm", format:"a4" \}\)/);
  assert.match(panel, /wa\.me/);
  assert.match(panel, /mailto:/);
  assert.match(panel, /record_payment/);
  assert.match(panel, /record_refund/);
  assert.match(panel, /list_reconciliation/);
  assert.match(panel, /GlobalTaxEditor/);
});

test("Unified app issues only when backend capabilities are ready and keeps other countries draft-only", () => {
  assert.match(edge, /body\.action === "capabilities"/);
  assert.match(edge, /issuance_ready/);
  assert.match(edge, /data\?\.country_code === "GB"/);
  assert.match(migration, /\x27country_code\x27,v_country_code/);
  assert.match(home, /action:"capabilities"/);
  assert.match(home, /capabilities\?\.data\?\.issuance_ready === true/);
  assert.match(home, /action:"issue"/);
  assert.match(home, /documentStatus:"issued"/);
  assert.match(history, /APP_EDITION === "global"/);
  assert.match(history, /GlobalInvoicesPanel/);
});

test("Global invoice drafts preserve the customer relationship for final buyer snapshots", () => {
  assert.match(stores, /workspaceRecords.*table:"clients"/s);
  assert.match(stores, /client_id: clientId/);
  assert.match(stores, /billing_address:\{ formatted:clientAddress \}/);
});

test("Global invoice manager fails closed until backend migration and Edge Function are ready", () => {
  assert.match(panel, /action:"capabilities"/);
  assert.match(panel, /issuanceReady:false, commercialIssuanceReady:false, ledgerReady:false/);
  assert.match(panel, /backendCapabilities\.issuanceReady/);
  assert.match(panel, /backendCapabilities\.commercialIssuanceReady/);
  assert.match(panel, /backendCapabilities\.ledgerReady/);
});
