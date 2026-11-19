import test from "node:test";
import assert from "node:assert/strict";
import { validateGoodsReceiptAction } from "./assistant-goods-receipt-validation.mjs";

const orderId = "123e4567-e89b-42d3-a456-426614174000";
const warehouseId = "123e4567-e89b-42d3-a456-426614174001";
const lineId = "123e4567-e89b-42d3-a456-426614174002";
const action = (overrides = {}) => ({
  type: "receive_purchase_order",
  payload: {
    purchase_order_id: orderId,
    warehouse_id: warehouseId,
    items: [{ purchase_order_item_id: lineId, quantity: 2.5, batch_number: "B-1", expires_on: "2027-01-31" }],
    ...overrides,
  },
});

test("normalizes a valid goods receipt proposal", () => {
  const result = validateGoodsReceiptAction(action());
  assert.equal(result.type, "receive_purchase_order");
  assert.equal(result.payload.items[0].quantity, 2.5);
  assert.equal(result.payload.items[0].expires_on, "2027-01-31");
});

test("rejects malformed IDs, missing lines and excessive item counts", () => {
  assert.equal(validateGoodsReceiptAction(action({ purchase_order_id: "not-a-uuid" })), null);
  assert.equal(validateGoodsReceiptAction(action({ warehouse_id: "not-a-uuid" })), null);
  assert.equal(validateGoodsReceiptAction(action({ items: [] })), null);
  assert.equal(validateGoodsReceiptAction(action({ items: Array.from({ length: 201 }, () => ({ purchase_order_item_id: lineId, quantity: 1 })) })), null);
});

test("rejects invalid quantities and malformed expiry dates", () => {
  assert.equal(validateGoodsReceiptAction(action({ items: [{ purchase_order_item_id: lineId, quantity: 0 }] })), null);
  assert.equal(validateGoodsReceiptAction(action({ items: [{ purchase_order_item_id: lineId, quantity: 1.00001 }] })), null);
  assert.equal(validateGoodsReceiptAction(action({ items: [{ purchase_order_item_id: lineId, quantity: 1, expires_on: "31-01-2027" }] })), null);
});

test("does not accept another action type", () => {
  assert.equal(validateGoodsReceiptAction({ type: "create_stock", payload: {} }), null);
});

test("rejects duplicate purchase-order line IDs to avoid ambiguous double receipt lines", () => {
  const duplicate = action({ items: [
    { purchase_order_item_id: lineId, quantity: 1 },
    { purchase_order_item_id: lineId, quantity: 2 },
  ] });
  assert.equal(validateGoodsReceiptAction(duplicate), null);
});

test("rejects impossible calendar dates, not just malformed date strings", () => {
  assert.equal(validateGoodsReceiptAction(action({ items: [
    { purchase_order_item_id: lineId, quantity: 1, expires_on: "2027-02-29" },
  ] })), null);
  assert.equal(validateGoodsReceiptAction(action({ items: [
    { purchase_order_item_id: lineId, quantity: 1, expires_on: "2028-02-29" },
  ] })).payload.items[0].expires_on, "2028-02-29");
});
