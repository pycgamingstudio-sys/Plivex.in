import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/202611160001_global_part4_crm_warehouse_procurement.sql", import.meta.url), "utf8");
const supplierLookupMigration = await readFile(new URL("../../../supabase/migrations/20261122195000_global_supplier_gstin_lookup.sql", import.meta.url), "utf8");
const operations = await readFile(new URL("../../../supabase/migrations/202611160002_global_part4_transactional_operations.sql", import.meta.url), "utf8");
const endpoint = await readFile(new URL("../../../supabase/functions/global-part4/index.ts", import.meta.url), "utf8");
const indiaMigration = await readFile(new URL("../../../supabase/migrations/202611160003_india_part4_warehouse_crm_purchase.sql", import.meta.url), "utf8");
const indiaOperations = await readFile(new URL("../../../supabase/migrations/202611160004_india_part4_transactional_rpcs.sql", import.meta.url), "utf8");
const globalUi = await readFile(new URL("../../../src/components/global/GlobalPart4Panel.jsx", import.meta.url), "utf8");
const indiaUi = await readFile(new URL("../../../src/components/dashboard/IndiaPart4Tab.jsx", import.meta.url), "utf8");
const globalApp = await readFile(new URL("../../../src/global/GlobalApp.jsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../../../src/pages/Dashboard.jsx", import.meta.url), "utf8");
const indiaSales = await readFile(new URL("../../../supabase/migrations/202611160005_india_invoice_stock_atomicity.sql", import.meta.url), "utf8");
const globalSales = await readFile(new URL("../../../supabase/migrations/202611160006_global_invoice_stock_atomicity.sql", import.meta.url), "utf8");
const stockTab = await readFile(new URL("../../../src/components/dashboard/StockTab.jsx", import.meta.url), "utf8");
const globalRecords = await readFile(new URL("../../../supabase/functions/global-business-records/index.ts", import.meta.url), "utf8");

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
  assert.ok(migration.includes("create policy %I on global.%I for select to authenticated"));
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

test("India CRM and procurement additions are additive and enforce workspace-composite references", () => {
  assert.match(indiaMigration, /add column if not exists score smallint/);
  assert.match(indiaMigration, /next_follow_up_at timestamptz/);
  assert.match(indiaMigration, /create table if not exists public\.warehouses/);
  assert.match(indiaMigration, /create table if not exists public\.purchase_orders/);
  assert.match(indiaMigration, /foreign key\(workspace_id,lead_id\) references public\.leads\(workspace_id,id\)/);
  assert.match(indiaMigration, /foreign key\(workspace_id,stock_id\) references public\.stock\(workspace_id,id\)/);
  assert.match(indiaMigration, /enable row level security/);
  assert.doesNotMatch(indiaMigration, /drop table/i);
});

test("warehouse transfer and receipt ledgers retain idempotency fingerprints", () => {
  assert.match(migration, /warehouse_stock_movements/);
  assert.match(migration, /request_fingerprint text not null/);
  assert.match(operations, /request_fingerprint<>v_fingerprint/);
  assert.match(operations, /movement_type,quantity_delta,reference_type/);
});


test("Global Part 4 UI is wired to authenticated CRM, warehouse and procurement operations", () => {
  assert.match(globalApp, /GlobalPart4Panel/);
  for (const tab of ["crm","inventory"]) assert.match(globalApp, new RegExp(`id: "${tab}"`));
  for (const section of ["warehouses","transfers","purchasing","movements"]) assert.match(globalUi, new RegExp(`id: "${section}"`));
  for (const operation of ["create_lead","update_lead","add_lead_activity","create_warehouse","create_purchase_order","receive_purchase_order"]) assert.ok(globalUi.includes(operation));
  assert.match(globalUi, /idempotency_key: transferKey/);
  assert.match(globalUi, /idempotency_key: receiptKey/);
  assert.match(globalUi, /scoreLead/);
  assert.match(globalUi, /warehouse_stock_movements/);
});

test("India Part 4 UI uses workspace-scoped reads and transactional database RPCs", () => {
  assert.match(dashboard, /IndiaPart4Tab user=\{user\}/);
  assert.match(dashboard, /id: "warehouses"/);
  assert.match(indiaUi, /eq\("workspace_id",workspaceId\)/);
  assert.match(indiaUi, /india_part4_create_purchase_order/);
  assert.match(indiaUi, /india_part4_receive_purchase_order/);
  assert.match(indiaUi, /india_part4_transfer_stock/);
  assert.match(indiaUi, /idempotency_key:receiptKey/);
  assert.match(indiaUi, /idempotency_key:transferKey/);
});

test("India stock inserts receive a default warehouse and opening balances enter the movement ledger", () => {
  assert.match(indiaOperations, /ensure_stock_default_warehouse/);
  assert.match(indiaOperations, /before insert or update of workspace_id,warehouse_id on public\.stock/);
  assert.match(indiaOperations, /Opening balance migrated into warehouse ledger/);
  assert.match(indiaOperations, /security definer/);
});

test("India purchase receipt and stock transfer RPCs are atomic, tenant-scoped and idempotent", () => {
  assert.match(indiaOperations, /india_part4_create_purchase_order/);
  assert.match(indiaOperations, /india_part4_receive_purchase_order/);
  assert.match(indiaOperations, /india_part4_transfer_stock/);
  assert.match(indiaOperations, /pg_advisory_xact_lock/);
  assert.match(indiaOperations, /request_fingerprint/);
  assert.match(indiaOperations, /has_ws_role\(v_workspace/);
  assert.match(indiaOperations, /quantity_received\+v_qty>v_po_item\.quantity_ordered/);
  assert.match(indiaOperations, /revoke all on function public\.india_part4_transfer_stock/);
});


test("India stock variants, barcodes, purchase cost and batch receipts are represented in the schema and UI", () => {
  assert.match(indiaOperations, /add column if not exists purchase_cost/);
  assert.match(indiaOperations, /add column if not exists barcode/);
  assert.match(indiaOperations, /add column if not exists variant_of/);
  assert.match(indiaOperations, /create table if not exists public\.inventory_batches/);
  assert.match(indiaOperations, /inventory_batches_expiry_idx/);
  assert.match(indiaOperations, /v_po_item\.unit_cost/);
  assert.match(stockTab, /Barcode/);
  assert.match(stockTab, /Variant of/);
  assert.match(stockTab, /Variant label/);
});

test("India invoice sales deduct exact warehouse stock, consume batches and reverse on cancellation", () => {
  assert.match(indiaSales, /apply_invoice_stock/);
  assert.match(indiaSales, /reverse_invoice_stock/);
  assert.match(indiaSales, /insufficient_stock/);
  assert.match(indiaSales, /insufficient_batch_stock/);
  assert.match(indiaSales, /movement_type,quantity_delta,reference_type/);
  assert.match(indiaSales, /stock_reversed/);
  assert.match(indiaSales, /legacy_stock_allocation_unavailable/);
});

test("Global products support barcode variants and invoice issuance consumes default warehouse stock", () => {
  assert.match(globalSales, /add column if not exists barcode/);
  assert.match(globalSales, /add column if not exists variant_of/);
  assert.match(globalSales, /create_default_warehouse_for_workspace/);
  assert.match(globalSales, /global_apply_invoice_stock/);
  assert.match(globalSales, /insufficient_batch_stock/);
  assert.match(globalSales, /sales_invoice/);
  assert.match(globalRecords, /"barcode", "variant_of", "variant_label"/);
});


test("Global purchasing can look up saved suppliers by GSTIN within the active workspace", () => {
  assert.match(supplierLookupMigration, /global\.suppliers/);
  assert.match(supplierLookupMigration, /user_id=p_user_id/);
  assert.match(supplierLookupMigration, /p_workspace_id/);
  assert.match(supplierLookupMigration, /tax_registration_number/);
  assert.match(endpoint, /"suppliers"/);
  assert.match(globalUi, /Find saved supplier by GSTIN/);
  assert.match(globalUi, /findSavedGstinRecords\(data\.suppliers/);
  assert.match(globalUi, /local workspace lookup only/);
});
