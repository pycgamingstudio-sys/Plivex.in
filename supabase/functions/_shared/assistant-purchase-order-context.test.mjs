import test from "node:test";
import assert from "node:assert/strict";
import { validatePurchaseOrderAgainstContext } from "./assistant-purchase-order-context.mjs";

const stockId = "123e4567-e89b-42d3-a456-426614174010";
const action = {
  type: "create_purchase_order",
  payload: {
    supplier_name: "Sharma Traders",
    items: [{ stock_id: stockId, quantity_ordered: 20, unit_cost: 50 }],
  },
};
const context = { unavailableModules: [], records: { stock: [{ id: stockId, name: "Sugar", unit: "kg" }] } };

test("matches purchase-order lines to exact workspace stock records", () => {
  const result = validatePurchaseOrderAgainstContext(action, context);
  assert.equal(result.ok, true);
  assert.match(result.summary, /Sharma Traders.*20 kg Sugar at 50 each/);
});

test("rejects stock items not present in live workspace context", () => {
  assert.equal(validatePurchaseOrderAgainstContext(action, { records: { stock: [] } }).reason, "stock_item_not_in_loaded_context");
});

test("fails closed when stock context is unavailable", () => {
  assert.equal(validatePurchaseOrderAgainstContext(action, { unavailableModules: ["stock"], records: { stock: [] } }).reason, "stock_context_unavailable");
});

test("does not alter unrelated action types", () => {
  assert.deepEqual(validatePurchaseOrderAgainstContext({ type: "create_client", summary: "Client" }, context), { ok: true, summary: "Client" });
});
