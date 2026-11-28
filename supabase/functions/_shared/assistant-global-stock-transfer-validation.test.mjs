import test from "node:test";
import assert from "node:assert/strict";
import { validateGlobalStockTransferAction, validateGlobalStockTransferAgainstContext } from "./assistant-global-stock-transfer-validation.mjs";

const from = "11111111-1111-4111-8111-111111111111";
const to = "22222222-2222-4222-8222-222222222222";
const product = "33333333-3333-4333-8333-333333333333";

test("validates a transfer between two distinct warehouses", () => {
  assert.deepEqual(validateGlobalStockTransferAction({ type: "transfer_global_stock", payload: {
    from_warehouse_id: from, to_warehouse_id: to, items: [{ product_id: product, quantity: 2.125 }], notes: "Move to branch"
  }}), { type: "transfer_global_stock", payload: {
    from_warehouse_id: from, to_warehouse_id: to, items: [{ product_id: product, quantity: 2.125 }], notes: "Move to branch"
  }});
});

test("rejects same warehouse, invalid ids, duplicate products and invalid quantities", () => {
  const base = { from_warehouse_id: from, to_warehouse_id: to, items: [{ product_id: product, quantity: 1 }] };
  assert.equal(validateGlobalStockTransferAction({ type: "transfer_global_stock", payload: { ...base, to_warehouse_id: from } }), null);
  assert.equal(validateGlobalStockTransferAction({ type: "transfer_global_stock", payload: { ...base, items: [{ product_id: "bad", quantity: 1 }] } }), null);
  assert.equal(validateGlobalStockTransferAction({ type: "transfer_global_stock", payload: { ...base, items: [{ product_id: product, quantity: 0 }] } }), null);
  assert.equal(validateGlobalStockTransferAction({ type: "transfer_global_stock", payload: { ...base, items: [{ product_id: product, quantity: 1.00001 }] } }), null);
  assert.equal(validateGlobalStockTransferAction({ type: "transfer_global_stock", payload: { ...base, items: [base.items[0], base.items[0]] } }), null);
});

test("bounds item count and notes length", () => {
  const result = validateGlobalStockTransferAction({ type: "transfer_global_stock", payload: {
    from_warehouse_id: from, to_warehouse_id: to, items: [{ product_id: product, quantity: 1 }], notes: "x".repeat(1200)
  }});
  assert.equal(result.payload.notes.length, 1000);
  assert.equal(validateGlobalStockTransferAction({ type: "transfer_global_stock", payload: {
    from_warehouse_id: from, to_warehouse_id: to, items: Array.from({ length: 201 }, () => ({ product_id: product, quantity: 1 }))
  }}), null);
});

test("requires live workspace warehouses, products and sufficient source stock", () => {
  const action = validateGlobalStockTransferAction({ type: "transfer_global_stock", payload: {
    from_warehouse_id: from, to_warehouse_id: to, items: [{ product_id: product, quantity: 3 }]
  }});
  const context = {
    warehouses: [{ id: from, name: "Main", is_active: true }, { id: to, name: "Branch", is_active: true }],
    products: [{ id: product, name: "Sugar", is_active: true }],
    warehouse_stock_levels: [{ warehouse_id: from, product_id: product, quantity: 5 }],
  };
  assert.equal(validateGlobalStockTransferAgainstContext(action, context).ok, true);
  assert.equal(validateGlobalStockTransferAgainstContext(action, { ...context, warehouse_stock_levels: [{ warehouse_id: from, product_id: product, quantity: 2 }] }).reason, "insufficient_loaded_stock");
  assert.equal(validateGlobalStockTransferAgainstContext(action, { ...context, warehouses: [] }).reason, "warehouse_not_found");
  assert.equal(validateGlobalStockTransferAgainstContext(action, { ...context, context_unavailable: true }).reason, "context_unavailable");
});
