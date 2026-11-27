import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [endpoint, rpcMigration, transactionMigration, crmUi, warehouseUi] = await Promise.all([
  read("../../../supabase/functions/global-part4/index.ts"),
  read("../../../supabase/migrations/202611160001_global_part4_crm_warehouse_procurement.sql"),
  read("../../../supabase/migrations/202611160002_global_part4_transactional_operations.sql"),
  read("../../components/workspace/WorkspaceCRMPanel.jsx"),
  read("../../components/global/GlobalPart4Panel.jsx"),
]);

test("CRM and warehouse endpoints authenticate users and bind every operation to the requested workspace", () => {
  assert.match(endpoint, /authenticateGlobal\(req\)/);
  assert.match(endpoint, /p_user_id: auth\.user\.id/);
  assert.match(endpoint, /p_workspace_id: body\.workspace_id/);
  assert.match(rpcMigration, /from global\.workspace_members/);
  assert.match(rpcMigration, /status='active'/);
  assert.match(rpcMigration, /access_denied/);
});

test("CRM pipeline supports lead creation, updates and activity timeline", () => {
  for (const action of ["create_lead", "update_lead", "add_lead_activity"]) assert.ok(endpoint.includes(action));
  for (const stage of ["New Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]) assert.ok(crmUi.includes(stage));
  assert.match(crmUi, /main_workspace_complete_lead_activity/);
});

test("multi-warehouse procurement and stock transfer operations use allowlisted validated RPCs", () => {
  for (const action of ["create_warehouse", "create_purchase_order", "receive_purchase_order"]) assert.ok(endpoint.includes(action));
  assert.match(endpoint, /global_part4_list/);
  assert.match(endpoint, /global_part4_mutate/);
  assert.match(endpoint, /global_part4_transfer_stock/);
  assert.match(transactionMigration, /for update/i);
  assert.match(transactionMigration, /idempotency_key/);
  assert.match(warehouseUi, /New transfer/);
  assert.match(warehouseUi, /New purchase order/);
});

test("stock transfer rejects invalid quantities and maps insufficient stock and idempotency conflicts", () => {
  assert.match(endpoint, /quantity <= 0/);
  assert.match(endpoint, /Math\.round\(item\.quantity \* 10000\)/);
  assert.match(endpoint, /insufficient_stock/);
  assert.match(endpoint, /idempotency_conflict/);
  assert.match(rpcMigration, /insufficient_stock/);
});

test("warehouse and CRM resource reads are explicitly allowlisted", () => {
  assert.match(endpoint, /const RESOURCES = new Set/);
  assert.match(endpoint, /global_part4_list/);
  assert.match(rpcMigration, /create or replace function public\.global_part4_list/);
  assert.match(rpcMigration, /revoke all on function public\.global_part4_list/);
});
