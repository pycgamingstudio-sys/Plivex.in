import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeGlobalInvoiceSnapshot, getGlobalInvoicePdfFilename } from "../invoices/pdf-download.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("unified View Plans uses public workspace settings while standalone Global keeps its isolated auth context", async () => {
  const paywall = await read("../../lib/paywall.jsx");
  const modal = paywall.slice(paywall.indexOf("function PaywallModal"));
  const unifiedStart = modal.indexOf("if (isUnifiedBuild)");
  const globalStart = modal.indexOf("if (APP_EDITION === \"global\")", unifiedStart);
  const unifiedBranch = modal.slice(unifiedStart, globalStart);
  assert.match(unifiedBranch, /from\("profiles"\)[\s\S]*from\("workspace_settings"\)/);
  assert.match(unifiedBranch, /resolveWorkspaceBillingContext\(countryCode, currencyCode\)/);
  assert.doesNotMatch(unifiedBranch, /global-auth-context|user\.country_code|user\.currency_code/);
  assert.match(modal.slice(globalStart), /supabase\.functions\.invoke\("global-auth-context"/);
  assert.match(modal, /globalUser\?\.id === user\.id/);
  assert.match(modal, /const isGlobalWorkspace = APP_EDITION === "global" \|\| resolvedBillingContext\.edition === "global"/);
  assert.doesNotMatch(modal, /selectedBillingConfig \|\| \(APP_EDITION === "global" \? null : GLOBAL_BILLING\.IN\)/);
});

test("Global invoice PDF export normalizes snapshots and downloads a non-empty PDF blob", async () => {
  const panel = await read("../../components/global/GlobalInvoicesPanel.jsx");
  assert.match(panel, /normalizeGlobalInvoiceSnapshot\(invoice\.invoice_snapshot\)/);
  assert.match(panel, /const blob = doc\.output\("blob"\)/);
  assert.match(panel, /link\.download = getGlobalInvoicePdfFilename\(invoice, snap\)/);
  assert.match(panel, /URL\.createObjectURL\(blob\)/);
  assert.doesNotMatch(panel, /doc\.save\(/);
});

test("invoice snapshots tolerate JSON strings, nulls and malformed legacy values", () => {
  assert.deepEqual(normalizeGlobalInvoiceSnapshot({ currency_code: "USD" }), { currency_code: "USD" });
  assert.deepEqual(normalizeGlobalInvoiceSnapshot('{"currency_code":"USD"}'), { currency_code: "USD" });
  assert.deepEqual(normalizeGlobalInvoiceSnapshot(null), {});
  assert.deepEqual(normalizeGlobalInvoiceSnapshot("not-json"), {});
});

test("invoice PDF filenames are safe on Android and desktop filesystems", () => {
  assert.equal(getGlobalInvoicePdfFilename({ invoice_number: "INV/2026:001" }), "INV-2026-001.pdf");
  assert.equal(getGlobalInvoicePdfFilename({ invoice_number: "   " }), "Plivex-invoice.pdf");
});
