import test from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_MODULE_CATALOG, ASSISTANT_WRITE_TOOLS, normalizeAssistantActionBatch, describeToolAvailability } from "./assistant-tool-registry.mjs";

const validator = (action) => action && ASSISTANT_WRITE_TOOLS[action.type] && action.payload
  ? { type: action.type, payload: action.payload }
  : null;

test("allows only the explicitly implemented confirmation actions", () => {
  assert.deepEqual(Object.keys(ASSISTANT_WRITE_TOOLS).sort(), [
    "create_client", "create_expense", "create_global_client", "create_invoice", "create_lead", "create_purchase_order", "create_quotation", "create_stock", "create_warehouse", "receive_purchase_order", "record_global_invoice_payment"
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
