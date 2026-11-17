import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/202611170001_country_reset_part4_cleanup.sql", import.meta.url), "utf8");
const settings = await readFile(new URL("../../components/global/WorkspaceCountrySettings.jsx", import.meta.url), "utf8");

test("atomic country reset deletes Global Part 4 dependants before products and workspaces", () => {
  const ordered = [
    "delete from global.stock_transfer_items",
    "delete from global.stock_transfers",
    "delete from global.purchase_order_items",
    "delete from global.purchase_orders",
    "delete from global.inventory_batches",
    "delete from global.warehouse_stock_movements",
    "delete from global.warehouse_stock_levels",
    "delete from global.warehouses",
    "delete from global.crm_activities",
    "delete from global.crm_leads",
    "delete from global.products",
  ];
  let last = -1;
  for (const statement of ordered) {
    const position = migration.indexOf(statement);
    assert.ok(position > last, statement + " must follow its dependants");
    last = position;
  }
});

test("atomic country reset deletes India procurement dependants before stock and warehouses", () => {
  const ordered = [
    "delete from public.purchase_receipt_items",
    "delete from public.purchase_receipts",
    "delete from public.purchase_order_items",
    "delete from public.purchase_orders",
    "delete from public.stock_movements",
    "delete from public.stock where",
    "delete from public.warehouses",
  ];
  let last = -1;
  for (const statement of ordered) {
    const position = migration.indexOf(statement);
    assert.ok(position > last, statement + " must follow its dependants");
    last = position;
  }
  assert.match(migration, /create or replace function public\.reset_workspace_country_atomic/);
  assert.match(migration, /grant execute on function public\.reset_workspace_country_atomic\(uuid,text,text,text,text\) to service_role/);
});

test("destructive country reset requires backup attestation and explicit DELETE confirmation", () => {
  assert.match(settings, /No automatic backup is created by this reset/);
  assert.match(settings, /I have exported and verified a backup/);
  assert.match(settings, /!backupConfirmed \|\| confirmationText\.trim\(\) !== "DELETE"/);
  assert.match(settings, /disabled=\{saving \|\| !backupConfirmed \|\| confirmationText\.trim\(\) !== "DELETE"\}/);
});
