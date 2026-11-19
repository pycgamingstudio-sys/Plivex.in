import test from "node:test";
import assert from "node:assert/strict";
import { buildAssistantBusinessAnalytics, groupNumericTotals } from "./assistant-business-analytics.mjs";

test("calculates overdue invoice aging without mixing monetary currencies", () => {
  const result = buildAssistantBusinessAnalytics({
    asOfDate: "2026-11-19",
    invoices: [
      { number: "A-1", status: "pending", due_date: "2026-11-18", total: 100, currency: "INR" },
      { number: "A-2", status: "sent", due_date: "2026-11-01", total: 100, currency: "USD" },
      { number: "A-3", status: "paid", due_date: "2026-11-01" },
      { number: "A-4", status: "pending", due_date: "2026-10-01", is_draft: true },
    ],
  });
  assert.deepEqual(result.receivables, {
    openInvoiceCount: 2,
    overdueInvoiceCount: 2,
    overdueAgeBuckets: { "1_7_days": 1, "8_30_days": 1, "over_30_days": 0 },
    oldestOverdueDays: 18,
  });
  assert.equal("totalOutstanding" in result.receivables, false);
});

test("uses per-item stock thresholds and returns bounded reorder candidates", () => {
  const result = buildAssistantBusinessAnalytics({
    stock: [
      { name: "Sugar", sku: "S-1", quantity: 2, low_stock: 5, unit: "kg" },
      { name: "Rice", sku: "R-1", quantity: 10, low_stock: 4, unit: "kg" },
      { name: "Tea", quantity: 0, low_stock: 0, unit: "packet" },
    ],
  });
  assert.equal(result.inventory.lowStockCount, 2);
  assert.deepEqual(result.inventory.lowStockItems.map((item) => item.name), ["Sugar", "Tea"]);
});

test("summarizes stock movement types and handles missing optional data", () => {
  const result = buildAssistantBusinessAnalytics({
    stockMovements: [{ movement_type: "receipt" }, { movement_type: "transfer" }, { movement_type: "receipt" }],
  });
  assert.equal(result.inventory.movementRecordCount, 3);
  assert.deepEqual(result.inventory.movementTypes, { receipt: 2, transfer: 1 });
  assert.equal(result.receivables.oldestOverdueDays, 0);
});

test("does not calculate overdue aging without a valid reference date", () => {
  const result = buildAssistantBusinessAnalytics({
    asOfDate: "today",
    invoices: [{ status: "pending", due_date: "2026-01-01" }],
  });
  assert.equal(result.receivables.openInvoiceCount, 1);
  assert.equal(result.receivables.overdueInvoiceCount, 0);
});

test("groups money by currency and never adds different currencies together", () => {
  
  const result = groupNumericTotals([
    { total: 1200, currency: "INR" },
    { total: 80, currency: "USD" },
    { total: 300, currency: "INR" },
  ], "total", "currency");
  assert.equal(result.total, null);
  assert.deepEqual(result.byGroup, { INR: 1500, USD: 80 });
  assert.equal(result.mixedGroups, true);
});

test("returns a grand total only when inventory quantities share one unit", () => {
  
  const mixed = groupNumericTotals([
    { quantity: 10, unit: "kg" },
    { quantity: 12, unit: "pcs" },
  ], "quantity", "unit");
  assert.equal(mixed.total, null);
  assert.deepEqual(mixed.byGroup, { KG: 10, PCS: 12 });
  const same = groupNumericTotals([{ quantity: 2, unit: "kg" }, { quantity: 3, unit: "kg" }], "quantity", "unit");
  assert.equal(same.total, 5);
});

test("does not report a total when currency or unit is missing", () => {
  const { groupNumericTotals } = requireAnalyticsHelpers;
  const result = groupNumericTotals([{ total: 200 }], "total", "currency");
  assert.equal(result.total, null);
  assert.equal(result.mixedGroups, true);
});

test("identifies overdue open purchase orders without treating completed orders as late", () => {
  const result = buildAssistantBusinessAnalytics({
    asOfDate: "2026-11-19",
    purchaseOrders: [
      { supplier_name: "A", supplier_reference: "PO-1", status: "ordered", expected_date: "2026-11-10" },
      { supplier_name: "B", status: "received", expected_date: "2026-11-01" },
      { supplier_name: "C", status: "ordered", expected_date: "2026-11-25" },
    ],
  });
  assert.equal(result.purchasing.openOrderCount, 2);
  assert.equal(result.purchasing.overdueExpectedOrderCount, 1);
  assert.equal(result.purchasing.overdueOrders[0].daysOverdue, 9);
});
