import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/202611160001_global_part4_crm_warehouse_procurement.sql", import.meta.url), "utf8");
const operations = await readFile(new URL("../../../supabase/migrations/202611160002_global_part4_transactional_operations.sql", import.meta.url), "utf8");
const endpoint = await readFile(new URL("../../../supabase/functions/global-part4/index.ts", import.meta.url), "utf8");

test("Part 4 adds Global CRM, warehouses, batches and purchasing without altering India tables", () => {
  for (const table of ["warehouses","warehouse_stock_levels","inventory_batches","stock_transfers","purchase_orders","purchase_order_items","crm_leads","crm_activities"]) {
    assert.match(migration, new RegExp("create table if not exists global\\." + table + "\\b"));
  }
  assert.doesNotMatch(migration, /alter table public\\./i);
  assert.doesNotMatch(migration, /drop table/i);
});

test("all new Global Part 4 tables enable member-scoped RLS", () => {
  assert.ok(migration.includes("foreach t in array array["));
  assert.ok(migration.includes("alter table global.%I enable row level security"));
  assert.ok(migration.includes("create policy global_%I_select_member"));
  for (const table of ["warehouses","warehouse_stock_levels","inventory_batches","stock_transfers","stock_transfer_items","purchase_orders","purchase_order_items","crm_leads","crm_activities"]) {
    assert.match(migration, new RegExp("'" + table + "'"));
  }
  assert.match(operations, /global_purchase_receipts_select_member/);
  assert.match(operations, /global_purchase_receipt_items_select_member/);
});

test("inventory transfer is transactional, role-gated and idempotent", () => {
  assert.match(migration, /global_part4_transfer_stock/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /insufficient_stock/);
  assert.match(migration, /unique\(workspace_id,idempotency_key\)/);
  assert.ok(migration.includes("revoke all on function public.global_part4_transfer_stock"));
});

test("purchase receiving cannot exceed ordered quantity and updates warehouse balances atomically", () => {
  assert.match(operations, /global_part4_mutate/);
  assert.match(operations, /quantity_received\+v_qty>v_po_item\.quantity_ordered/);
  assert.match(operations, /warehouse_stock_levels/);
  assert.match(operations, /purchase_receipts/);
  assert.match(operations, /idempotency_key/);
});

test("Part 4 edge endpoint authenticates, validates tenant IDs and restricts actions", () => {
  assert.match(endpoint, /authenticateGlobal\(req\)/);
  assert.match(endpoint, /UUID\.test\(body\.workspace_id\)/);
  assert.match(endpoint, /global_part4_list/);
  assert.match(endpoint, /global_part4_transfer_stock/);
  assert.match(endpoint, /global_part4_mutate/);
  assert.match(endpoint, /MAX_BODY/);
});
