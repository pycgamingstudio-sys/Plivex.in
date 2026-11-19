import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../../supabase/migrations/20261119210000_recover_legacy_global_workspaces.sql", import.meta.url),
  "utf8",
);

test("legacy Global recovery maps every non-India canonical workspace to a verified Global owner", () => {
  assert.match(migration, /legacy_global_workspace_id = gen_random_uuid\(\)/);
  assert.match(migration, /join public\.profiles p on p\.id = ws\.created_by/);
  assert.match(migration, /pm\.role='admin' and pm\.status='active'/);
  assert.match(migration, /insert into global\.workspaces/);
  assert.match(migration, /insert into global\.user_profiles/);
  assert.match(migration, /insert into global\.workspace_members/);
  assert.match(migration, /gm\.role='owner' and gm\.status='active'/);
  assert.match(migration, /global\.user_profiles gp[\s\S]*default_workspace_id=m\.global_workspace_id/);
});

test("legacy business records are copied with stable identities into isolated Global tables", () => {
  for (const table of [
    "business_profiles", "warehouses", "clients", "products", "stock_levels",
    "stock_movements", "invoices", "invoice_items", "expenses", "quotations", "quotation_items",
  ]) {
    assert.match(migration, new RegExp("insert into global\\." + table));
  }
  for (const source of [
    "public.business_profile", "public.warehouses", "public.clients", "public.stock",
    "public.stock_movements", "public.invoices", "public.invoice_items", "public.expenses", "public.quotations",
  ]) {
    assert.ok(migration.includes(source), "missing source table " + source);
  }
  assert.match(migration, /md5\(m\.global_workspace_id::text\|\|':legacy-quotation-item:'/);
  assert.match(migration, /on conflict \(id\) do nothing/);
  assert.match(migration, /on conflict \(workspace_id,product_id\) do update/);
});

test("legacy invoice lines are imported before restoring invoice status", () => {
  const invoiceInsert = migration.indexOf("insert into global.invoices(");
  const itemInsert = migration.indexOf("insert into global.invoice_items(");
  const statusRestore = migration.indexOf("update global.invoices gi");
  assert.ok(invoiceInsert >= 0 && itemInsert > invoiceInsert && statusRestore > itemInsert);
  assert.match(migration, /'draft',upper\(coalesce\(nullif\(i\.currency,''\),m\.currency_code\)\)/);
  assert.match(migration, /_legacy_public_invoice/);
});

test("historical currencies are preserved and accounting side effects are suppressed only in the private migration transaction", () => {
  assert.match(migration, /private\.legacy_global_import_transactions/);
  assert.match(migration, /private\.is_legacy_global_import\(\)/);
  assert.match(migration, /if private\.is_legacy_global_import\(\) then return new; end if;/);
  assert.match(migration, /upper\(coalesce\(nullif\(e\.currency_code,''\),m\.currency_code\)\)/);
  assert.match(migration, /upper\(coalesce\(nullif\(i\.currency,''\),m\.currency_code\)\)/);
  assert.match(migration, /Original source row remains in public\.quotations/);
});

test("recovery is atomic, repeat-safe, verifies imported records, and never deletes source business data", () => {
  assert.match(migration, /^--[\s\S]*?begin;/);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /Legacy Global recovery verification failed/);
  assert.match(migration, /Legacy Global recovery identity verification failed/);
  assert.doesNotMatch(migration, /drop table|truncate table/i);
  assert.doesNotMatch(migration, /delete from public\.(clients|stock|stock_movements|invoices|invoice_items|expenses|quotations)/i);
  assert.doesNotMatch(migration, /delete from global\.(clients|products|stock_levels|stock_movements|invoices|invoice_items|expenses|quotations)/i);
});
