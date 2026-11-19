import test from "node:test";
import assert from "node:assert/strict";
import { validatePurchaseOrderAction } from "./assistant-purchase-order-validation.mjs";

const stockA = "123e4567-e89b-42d3-a456-426614174010";
const stockB = "123e4567-e89b-42d3-a456-426614174011";
const valid = (overrides = {}) => ({
  type: "create_purchase_order",
  payload: {
    supplier_name: "Sharma Traders",
    supplier_reference: "PO-2026-17",
    expected_date: "2026-12-01",
    notes: "Deliver in morning",
    items: [{ stock_id: stockA, quantity_ordered: 25, unit_cost: 50 }],
    ...overrides,
  },
});

test("normalizes a valid purchase order draft", () => {
  const result = validatePurchaseOrderAction(valid());
  assert.equal(result.payload.supplier_name, "Sharma Traders");
  assert.equal(result.payload.items[0].quantity_ordered, 25);
  assert.equal(result.payload.expected_date, "2026-12-01");
});

test("requires supplier and at least one bounded item", () => {
  assert.equal(validatePurchaseOrderAction(valid({ supplier_name: "" })), null);
  assert.equal(validatePurchaseOrderAction(valid({ items: [] })), null);
  assert.equal(validatePurchaseOrderAction(valid({ items: Array.from({ length: 201 }, () => ({ stock_id: stockA, quantity_ordered: 1, unit_cost: 1 })) })), null);
});

test("rejects invalid IDs, quantities, costs and excessive decimal precision", () => {
  assert.equal(validatePurchaseOrderAction(valid({ items: [{ stock_id: "bad", quantity_ordered: 1, unit_cost: 1 }] })), null);
  assert.equal(validatePurchaseOrderAction(valid({ items: [{ stock_id: stockA, quantity_ordered: 0, unit_cost: 1 }] })), null);
  assert.equal(validatePurchaseOrderAction(valid({ items: [{ stock_id: stockA, quantity_ordered: 1.00001, unit_cost: 1 }] })), null);
  assert.equal(validatePurchaseOrderAction(valid({ items: [{ stock_id: stockA, quantity_ordered: 1, unit_cost: -1 }] })), null);
  assert.equal(validatePurchaseOrderAction(valid({ items: [{ stock_id: stockA, quantity_ordered: 1, unit_cost: 1.00001 }] })), null);
});

test("rejects duplicate stock lines and impossible expected dates", () => {
  assert.equal(validatePurchaseOrderAction(valid({ items: [
    { stock_id: stockA, quantity_ordered: 1, unit_cost: 1 },
    { stock_id: stockA, quantity_ordered: 2, unit_cost: 1 },
  ] })), null);
  assert.equal(validatePurchaseOrderAction(valid({ expected_date: "2027-02-29" })), null);
  assert.equal(validatePurchaseOrderAction(valid({ expected_date: "2028-02-29" })).payload.expected_date, "2028-02-29");
});

test("does not accept a different action type", () => {
  assert.equal(validatePurchaseOrderAction({ type: "create_stock", payload: {} }), null);
});

test("rejects oversized numeric values and trailing ID characters", () => {
  assert.equal(validatePurchaseOrderAction(valid({ items: [{ stock_id: stockA + "x", quantity_ordered: 1, unit_cost: 1 }] })), null);
  assert.equal(validatePurchaseOrderAction(valid({ items: [{ stock_id: stockA, quantity_ordered: 1e30, unit_cost: 1 }] })), null);
  assert.equal(validatePurchaseOrderAction(valid({ expected_date: "2026-12-01-extra" })), null);
  assert.equal(validatePurchaseOrderAction(valid({ supplier_name: "S".repeat(201) })), null);
});
