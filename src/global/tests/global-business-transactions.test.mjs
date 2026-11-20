import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COUNTRY_REGISTRY } from "../countries/country-registry.js";
import { GLOBAL_COUNTRY_CURRENCIES, resolveInvoiceCurrencyForWorkspace } from "../tax/invoice-tax-integration.js";
import { getTaxInvoiceFormat } from "../tax/tax-invoice-formats.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("supported workspace countries resolve to their own invoice currency and tax presentation", () => {
  for (const country of COUNTRY_REGISTRY) {
    assert.equal(resolveInvoiceCurrencyForWorkspace(country.code, "INR"), country.currencyCode);
    assert.equal(GLOBAL_COUNTRY_CURRENCIES[country.code], country.currencyCode);
    assert.ok(getTaxInvoiceFormat(country.code));
  }
  assert.equal(resolveInvoiceCurrencyForWorkspace("US", "INR"), "USD");
  assert.equal(resolveInvoiceCurrencyForWorkspace("GB", "INR"), "GBP");
  assert.equal(resolveInvoiceCurrencyForWorkspace("IN", "INR"), "INR");
});

test("Global invoice endpoint supports draft creation and idempotent payment ledger only", async () => {
  const handler = await read("../../../supabase/functions/global-invoices/index.ts");
  const migration = await read("../../../supabase/migrations/202611150008_global_invoice_draft_and_payment_ledger.sql");
  assert.match(handler, /global_create_invoice_draft/);
  assert.match(handler, /global_record_invoice_payment/);
  assert.match(handler, /idempotency_key/);
  assert.match(migration, /tax_status','not_calculated/);
  assert.match(migration, /invoice_not_payable/);
  assert.match(migration, /p_workspace_id/);
});

test("Global stock movements use the authenticated atomic stock ledger", async () => {
  const handler = await read("../../../supabase/functions/global-stock-movements/index.ts");
  const migration = await read("../../../supabase/migrations/202611150007_global_inventory_movement_rpc.sql");
  assert.match(handler, /authenticateGlobal/);
  assert.match(handler, /global_record_stock_movement/);
  assert.match(handler, /idempotency_key/);
  assert.match(migration, /insufficient_stock/);
});

test("PLIVEX ONE saves non-India invoices as canonical public drafts", async () => {
  const stores = await read("../../lib/stores.js");
  const home = await read("../../pages/Home.jsx");
  const saveInvoice = await read("../../../supabase/functions/save-invoice/index.ts");
  const shareHelper = await read("../../lib/invoiceShare.js");
  assert.match(stores, /is_draft: isGlobalWorkspaceInvoice/);
  assert.match(stores, /Workspace country and base currency could not be verified/);
  assert.match(stores, /currency !== workspaceCurrency/);
  assert.doesNotMatch(stores, /action: "create_draft"/);
  assert.match(saveInvoice, /body\?\.is_draft !== true/);
  assert.match(saveInvoice, /globalTaxCalculation/);
  assert.match(home, /const issuedInvoice = null/);
  assert.doesNotMatch(home, /action:"capabilities"/);
  assert.doesNotMatch(home, /action:"issue_commercial"/);
  assert.match(home, /createInvoiceShareLink\(savedInvoice\.id, user\?\.workspace_id, isGlobalWorkspace\)/);
  assert.match(home, /allowGlobalDraftExport: isGlobalWorkspace/);
  assert.match(home, /profileLoading=\{workspaceTaxProfileLoading && !\(user\?\.country_code && user\?\.currency_code\)\}/);
  assert.match(shareHelper, /invoice-share/);
  assert.match(home, /This is not an issued tax invoice; payment-provider collection is not connected yet/);
});


test("Global invoices can explicitly select no-tax commercial treatment without registration data", async () => {
  const { calculateInvoiceGlobalTax } = await import("../tax/invoice-tax-integration.js");
  const invoice = {
    currency: "GBP",
    issueDate: "2026-11-19",
    discount: 0,
    discountType: "percent",
    items: [{ quantity: 2, rate: 125, gstRate: 0 }],
    globalTax: { countryCode: "GB", mode: "automatic", taxMode: "no_tax", noTaxConfirmed: true },
  };
  const result = calculateInvoiceGlobalTax(invoice, { countryCode: "GB", currencyCode: "GBP" });
  assert.equal(result.ok, true);
  assert.equal(result.status, "not_applicable");
  assert.equal(result.taxMinor, 0);
  assert.equal(result.totalMinor, 25000);
  assert.equal(result.taxSnapshot, null);
  assert.match(result.disclosure, /not been independently verified/);
});

test("Global no-tax commercial treatment requires explicit user confirmation", async () => {
  const { calculateInvoiceGlobalTax } = await import("../tax/invoice-tax-integration.js");
  const result = calculateInvoiceGlobalTax({
    currency: "GBP",
    issueDate: "2026-11-19",
    items: [{ quantity: 1, rate: 100 }],
    globalTax: { countryCode: "GB", taxMode: "no_tax", noTaxConfirmed: false },
  }, { countryCode: "GB", currencyCode: "GBP" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_TAX_CONFIRMATION_REQUIRED");
});

test("Global invoice UI distinguishes no-tax commercial invoices from zero-rated and exempt supplies", async () => {
  const editor = await read("../../components/invoice/GlobalTaxEditor.jsx");
  assert.match(editor, /global-tax-mode/);
  assert.match(editor, /No tax charged · commercial invoice/);
  assert.match(editor, /not a zero-rated or tax-exempt classification/);
  assert.match(editor, /Plivex does not decide whether your business or transaction legally qualifies/);
});


test("Global taxable invoice uses one accessible combined confirmation instead of three separate checkboxes", async () => {
  const editor = await read("../../components/invoice/GlobalTaxEditor.jsx");
  const source = await read("../tax/invoice-tax-integration.js");
  const edge = await read("../../../supabase/functions/save-invoice/_shared/tax/invoice-tax-integration.js");
  assert.match(editor, /global-tax-details-confirm/);
  assert.match(editor, /allowNoTax = true/);
  assert.match(editor, /min-h-11/);
  assert.doesNotMatch(editor, /registrationConfirmed === true} onChange/);
  assert.match(source, /TAX_DETAILS_CONFIRMATION_REQUIRED/);
  assert.match(edge, /TAX_DETAILS_CONFIRMATION_REQUIRED/);
  assert.match(source, /Confirm the saved registration details and invoice tax details together/);
});


test("Global commercial invoice creation has one atomic server-side finalization action", async () => {
  const handler = await read("../../../supabase/functions/global-invoices/index.ts");
  const panel = await read("../../components/global/GlobalInvoicesPanel.jsx");
  const migration = await read("../../../supabase/migrations/20261119100000_global_atomic_commercial_invoice_issue.sql");
  assert.match(handler, /create_final_commercial/);
  assert.match(handler, /global_create_and_issue_commercial_invoice/);
  assert.match(handler, /atomicCommercialProbe/);
  assert.match(handler, /create_final_tax/);
  assert.match(handler, /global_create_and_issue_tax_invoice/);
  assert.match(handler, /atomicTaxProbe/);
  assert.match(panel, /action:isTaxInvoice \? "create_final_tax" : "create_final_commercial"/);
  assert.match(panel, /UK VAT tax invoice · calculate VAT/);
  assert.match(panel, /allowNoTax=\{false\}/);
  assert.match(panel, /data\?\.invoice\?\.status !== "issued"/);
  assert.match(panel, /await downloadPdf\(data\.invoice\)/);
  assert.match(migration, /global_create_invoice_draft/);
  assert.match(migration, /global_issue_commercial_invoice/);
  assert.match(migration, /global_issue_invoice/);
  assert.match(migration, /global_create_and_issue_tax_invoice/);
  assert.match(migration, /delete from global\.invoices/);
});


test("Unified non-India workspaces keep the Main Workspace invoice routes", async () => {
  const app = await read("../../App.jsx");
  const panel = await read("../../components/global/GlobalInvoicesPanel.jsx");
  assert.match(app, /const isGlobalWorkspace = !isUnifiedBuild && APP_EDITION === "global"/);
  assert.match(app, /isGlobalWorkspace \? <AppLayout><GlobalApp section="invoices" \/><\/AppLayout> : <Home \/>/);
  assert.match(panel, /resolveGlobalInvoiceContext\(account\)/);
  assert.doesNotMatch(panel, /multi_currency|canAccess\(/);
  assert.match(panel, /currency_code:currency/);
});
