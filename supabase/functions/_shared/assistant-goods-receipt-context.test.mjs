import test from "node:test";
import assert from "node:assert/strict";
import { validateGoodsReceiptAgainstContext } from "./assistant-goods-receipt-context.mjs";

const orderId = "po-1", warehouseId = "wh-1", lineId = "line-1";
const action = (quantity = 3) => ({
  type: "receive_purchase_order",
  payload: { purchase_order_id: orderId, warehouse_id: warehouseId, items: [{ purchase_order_item_id: lineId, quantity }] },
});
const context = {
  unavailableModules: [],
  records: {
    warehouses: [{ id: warehouseId, name: "Main Godown", is_active: true }],
    purchase_orders: [{
      id: orderId, supplier_reference: "PO-2026-10", status: "partially_received",
      items: [{ id: lineId, quantity_ordered: 10, quantity_received: 4, stock_name: "Sugar", stock_unit: "kg" }],
    }],
  },
};

test("validates goods receipt against exact live PO line and active warehouse", () => {
  const result = validateGoodsReceiptAgainstContext(action(3), context);
  assert.equal(result.ok, true);
  assert.match(result.summary, /3 kg Sugar.*PO-2026-10.*Main Godown/);
});

test("rejects quantities above remaining PO line balance", () => {
  assert.equal(validateGoodsReceiptAgainstContext(action(7), context).reason, "quantity_exceeds_loaded_outstanding");
});

test("rejects unknown order lines, inactive warehouses and closed orders", () => {
  const badLine = action();
  badLine.payload.items[0].purchase_order_item_id = "unknown";
  assert.equal(validateGoodsReceiptAgainstContext(badLine, context).reason, "purchase_order_line_not_found");
  const badWarehouse = action();
  badWarehouse.payload.warehouse_id = "unknown";
  assert.equal(validateGoodsReceiptAgainstContext(badWarehouse, context).reason, "active_warehouse_not_in_loaded_context");
  const closed = structuredClone(context);
  closed.records.purchase_orders[0].status = "received";
  assert.equal(validateGoodsReceiptAgainstContext(action(), closed).reason, "purchase_order_not_open");
});

test("fails closed when a required context module is unavailable", () => {
  const unavailable = { ...context, unavailableModules: ["purchase_order_items"] };
  assert.equal(validateGoodsReceiptAgainstContext(action(), unavailable).reason, "context_unavailable");
});

test("leaves unrelated action types unchanged", () => {
  assert.deepEqual(validateGoodsReceiptAgainstContext({ type: "create_client", summary: "Add client" }, context), { ok: true, summary: "Add client" });
});
