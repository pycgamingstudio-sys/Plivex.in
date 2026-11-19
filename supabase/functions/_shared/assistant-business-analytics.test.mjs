import test from "node:test";
import assert from "node:assert/strict";
import { buildAssistantBusinessAnalytics } from "./assistant-business-analytics.mjs";

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
