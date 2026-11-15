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

test("Global drafts are stored as drafts and cannot be shared as issued tax invoices", async () => {
  const stores = await read("../../lib/stores.js");
  const home = await read("../../pages/Home.jsx");
  const backend = await read("../../api/backendClient.js");
  assert.match(stores, /APP_EDITION === "global"/);
  assert.match(stores, /action: "create_draft"/);
  assert.match(stores, /status: "draft"/);
  assert.match(backend, /global-invoices/);
  assert.match(backend, /global-stock-movements/);
  assert.match(home, /DRAFT · NOT A TAX INVOICE/);
  assert.match(home, /Global invoices are draft-only/);
  assert.match(home, /This is not an issued tax invoice; payment-provider collection is not connected yet/);
  assert.match(home, /action:"capabilities"/);
  assert.match(home, /action:"issue"/);
});
