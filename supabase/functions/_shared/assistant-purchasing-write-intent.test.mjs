import test from "node:test";
import assert from "node:assert/strict";
import { detectPurchasingWriteIntent } from "./assistant-purchasing-write-intent.mjs";

test("activates purchase-order creation for explicit order and Hinglish mangwaya requests", () => {
  assert.equal(detectPurchasingWriteIntent("create purchase order", { explicitWriteIntent: true }).purchaseOrderIntentActive, true);
  assert.equal(detectPurchasingWriteIntent("chini 50 kilo mangwaya", {}).purchaseOrderIntentActive, true);
});

test("activates warehouse creation only for an explicit or clarified warehouse task", () => {
  assert.equal(detectPurchasingWriteIntent("create new godown", { explicitWriteIntent: true }).warehouseIntentActive, true);
  assert.equal(detectPurchasingWriteIntent("warehouse report", {}).warehouseIntentActive, false);
  assert.equal(detectPurchasingWriteIntent("open a warehouse", {}).warehouseIntentActive, true);
  assert.equal(detectPurchasingWriteIntent("North Godown", { awaitingWarehouseField: true }).warehouseIntentActive, true);
});

test("allows goods receipt requests and field replies to continue through confirmation", () => {
  assert.equal(detectPurchasingWriteIntent("maal aa gaya", {}).goodsReceiptIntentActive, true);
  assert.equal(detectPurchasingWriteIntent("receive stock", { explicitWriteIntent: true }).goodsReceiptIntentActive, true);
  assert.equal(detectPurchasingWriteIntent("PO-17", { awaitingGoodsReceiptField: true }).goodsReceiptIntentActive, true);
  assert.equal(detectPurchasingWriteIntent("Sharma Traders", { awaitingPurchaseOrderField: true }).purchaseOrderIntentActive, true);
  assert.equal(detectPurchasingWriteIntent("North Godown", { awaitingWarehouseField: true }).warehouseIntentActive, true);
});

test("does not activate read-only purchasing questions", () => {
  const result = detectPurchasingWriteIntent("show purchase orders and warehouses", {});
  assert.equal(result.purchaseOrderIntentActive, false);
  assert.equal(result.warehouseIntentActive, false);
  assert.equal(result.goodsReceiptIntentActive, false);
});
