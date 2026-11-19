import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../../supabase/migrations/20261119230000_reconcile_legacy_global_invoice_lines.sql", import.meta.url),
  "utf8",
);

test("legacy issued invoice lines remain immutable outside the private import transaction", () => {
  assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog, global, private/);
  assert.match(migration, /if private\.is_legacy_global_import\(\) then/);
  assert.match(migration, /Issued invoice lines are immutable/);
});

test("legacy invoice discounts and taxes are allocated across lines without changing header totals", () => {
  assert.match(migration, /header_discount_minor::numeric\*base_minor/);
  assert.match(migration, /header_tax_minor::numeric\*base_minor/);
  assert.match(migration, /item_discount_minor/);
  assert.match(migration, /item_tax_minor/);
  assert.match(migration, /line_total_minor=allocated\.base_minor-allocated\.item_discount_minor\+allocated\.item_tax_minor/);
  assert.match(migration, /lines\.item_discount_minor<>i\.discount_minor/);
  assert.match(migration, /lines\.item_tax_minor<>i\.tax_minor/);
  assert.match(migration, /lines\.item_total_minor<>i\.total_minor/);
});

test("invoice reconciliation is atomic and only touches imported legacy invoices", () => {
  assert.match(migration, /where i\.invoice_snapshot \? '_legacy_public_invoice'/);
  assert.match(migration, /Legacy invoice line reconciliation stopped/);
  assert.match(migration, /Legacy invoice line reconciliation failed/);
  assert.match(migration, /begin;[\s\S]*commit;\s*$/);
  assert.doesNotMatch(migration, /delete from global\.invoice_items|truncate table/i);
});
