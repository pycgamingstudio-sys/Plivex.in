import test from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_MODULE_CATALOG, ASSISTANT_WRITE_TOOLS, normalizeAssistantActionBatch, describeToolAvailability } from "./assistant-tool-registry.mjs";

const validator = (action) => action && ASSISTANT_WRITE_TOOLS[action.type] && action.payload
  ? { type: action.type, payload: action.payload }
  : null;

test("allows only the explicitly implemented confirmation actions", () => {
  assert.deepEqual(Object.keys(ASSISTANT_WRITE_TOOLS).sort(), [
    "create_client", "create_expense", "create_global_branch", "create_global_client", "create_global_expense", "create_global_product", "create_global_supplier", "create_invoice", "create_lead", "create_purchase_order", "create_quotation", "create_stock", "create_warehouse", "receive_purchase_order", "record_global_invoice_payment", "request_global_approval", "set_global_member_permission", "transfer_global_stock"
  ]);
});

test("deduplicates equivalent actions independent of object key order", () => {
  const result = normalizeAssistantActionBatch([
    { type: "create_client", payload: { name: "A", phone: "1" } },
    { payload: { phone: "1", name: "A" }, type: "create_client" },
  ], validator);
  assert.equal(result.error, null);
  assert.equal(result.actions.length, 1);
});

test("rejects unsupported tools and rejects the entire batch", () => {
  const result = normalizeAssistantActionBatch([
    { type: "create_client", payload: { name: "A" } },
    { type: "create_supplier", payload: { name: "Main" } },
  ], validator);
  assert.equal(result.error, "UNSUPPORTED_OR_INVALID_ACTION");
  assert.deepEqual(result.actions, []);
});

test("rejects more than ten actions", () => {
  const result = normalizeAssistantActionBatch(Array.from({ length: 11 }, () => ({
    type: "create_client", payload: { name: "A" }
  })), validator);
  assert.equal(result.error, "TOO_MANY_ACTIONS");
});

test("catalog distinguishes implemented actions from planned modules", () => {
  assert.deepEqual(BUSINESS_MODULE_CATALOG.warehouses.writeTools, ["create_warehouse"]);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.global_clients.writeTools, ["create_global_client"]);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.suppliers.writeTools, ["create_global_supplier"]);
  assert.equal(BUSINESS_MODULE_CATALOG.suppliers.planned, false);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.stock_transfers.writeTools, ["transfer_global_stock"]);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.branches.writeTools, ["create_global_branch"]);
  assert.equal(BUSINESS_MODULE_CATALOG.branches.planned, false);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.member_permissions.writeTools, ["set_global_member_permission"]);
  assert.equal(BUSINESS_MODULE_CATALOG.member_permissions.planned, false);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.approvals.writeTools, ["request_global_approval"]);
  assert.equal(BUSINESS_MODULE_CATALOG.approvals.planned, false);
  assert.equal(BUSINESS_MODULE_CATALOG.stock_transfers.planned, false);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.global_expenses.writeTools, ["create_global_expense"]);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.global_products.writeTools, ["create_global_product"]);
  assert.equal(BUSINESS_MODULE_CATALOG.global_clients.planned, undefined);
  assert.equal(BUSINESS_MODULE_CATALOG.warehouses.planned, false);
  assert.equal(BUSINESS_MODULE_CATALOG.inventory.writeTools.includes("create_stock"), true);
  assert.equal(describeToolAvailability().length, Object.keys(BUSINESS_MODULE_CATALOG).length);
});

test("catalog marks the idempotent purchasing and warehouse executors as implemented", () => {
  assert.equal(BUSINESS_MODULE_CATALOG.warehouses.readContext, true);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.warehouses.writeTools, ["create_warehouse"]);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.purchase_orders.writeTools, ["create_purchase_order"]);
  assert.equal(BUSINESS_MODULE_CATALOG.purchase_orders.planned, false);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.purchase_receipts.writeTools, ["receive_purchase_order"]);
  assert.equal(BUSINESS_MODULE_CATALOG.purchase_receipts.planned, false);
  assert.deepEqual(BUSINESS_MODULE_CATALOG.payments.writeTools, ["record_global_invoice_payment"]);
  assert.equal(BUSINESS_MODULE_CATALOG.payments.planned, false);
});

test("supplier action is explicitly allow-listed and unrelated supplier writes remain unavailable", () => {
  const allowed = normalizeAssistantActionBatch([
    { type: "create_global_supplier", payload: { name: "Acme" } },
  ], validator);
  assert.equal(allowed.error, null);
  assert.equal(allowed.actions.length, 1);
  const denied = normalizeAssistantActionBatch([
    { type: "pay_supplier", payload: { name: "Acme", amount: 100 } },
  ], validator);
  assert.equal(denied.error, "UNSUPPORTED_OR_INVALID_ACTION");
});

test("stock transfer is an allow-listed confirmed action, not a direct write", () => {
  const allowed = normalizeAssistantActionBatch([
    { type: "transfer_global_stock", payload: { from_warehouse_id: "a", to_warehouse_id: "b", items: [] } },
  ], validator);
  assert.equal(allowed.error, null);
});
