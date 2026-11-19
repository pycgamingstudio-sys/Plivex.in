/**
 * Currency-safe, read-only business analytics for the assistant context.
 * Counts and operational flags are preferred over cross-currency monetary totals.
 */
const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function daysBetween(later, earlier) {
  const a = Date.parse(later + "T00:00:00Z");
  const b = Date.parse(earlier + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((a - b) / 86400000);
}

/**
 * Groups numeric totals by currency, unit or another explicit measurement key.
 * A grand total is exposed only when all rows share exactly one key.
 */
export function groupNumericTotals(items = [], valueField, groupField) {
  const byGroup = items.reduce((totals, item) => {
    const key = String(item?.[groupField] || "UNKNOWN").toUpperCase();
    const value = finite(item?.[valueField], NaN);
    if (Number.isFinite(value)) totals[key] = (totals[key] || 0) + value;
    return totals;
  }, {});
  const keys = Object.keys(byGroup);
  return {
    total: keys.length === 0 ? 0 : (keys.length === 1 && keys[0] !== "UNKNOWN" ? byGroup[keys[0]] : null),
    byGroup,
    mixedGroups: keys.length > 1 || keys.includes("UNKNOWN"),
  };
}

/**
 * @param {{
 *   invoices?: Array<Record<string, unknown>>,
 *   stock?: Array<Record<string, unknown>>,
 *   stockMovements?: Array<Record<string, unknown>>,
 *   purchaseOrders?: Array<Record<string, unknown>>,
 *   inventoryBatches?: Array<Record<string, unknown>>,
 *   asOfDate?: string
 * }} input
 */
export function buildAssistantBusinessAnalytics(input = {}) {
  const { invoices = [], stock = [], stockMovements = [], purchaseOrders = [], inventoryBatches = [], asOfDate } = input;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate || ""));
  const openInvoices = invoices.filter((item) => {
    const status = String(item?.status || "").toLowerCase();
    return !item?.is_draft && !["paid", "cancelled", "void", "written_off"].includes(status);
  });
  const overdue = validDate ? openInvoices.map((item) => ({
    invoice: String(item?.number || ""),
    dueDate: String(item?.due_date || ""),
    daysOverdue: daysBetween(asOfDate, String(item?.due_date || "")),
  })).filter((item) => item.daysOverdue !== null && item.daysOverdue > 0) : [];
  const lowStock = stock.filter((item) => {
    const quantity = finite(item?.quantity, NaN);
    const threshold = finite(item?.low_stock, 5);
    return Number.isFinite(quantity) && quantity <= threshold;
  }).slice(0, 50).map((item) => ({
    name: String(item?.name || ""),
    sku: String(item?.sku || ""),
    quantity: finite(item?.quantity),
    threshold: finite(item?.low_stock, 5),
    unit: String(item?.unit || ""),
  }));
  const openPurchaseOrders = purchaseOrders.filter((order) =>
    !["received", "cancelled", "closed"].includes(String(order?.status || "").toLowerCase())
  );
  const overduePurchaseOrders = validDate ? openPurchaseOrders.filter((order) => {
    const expectedDate = String(order?.expected_date || "");
    return Boolean(expectedDate) && daysBetween(asOfDate, expectedDate) > 0;
  }) : [];
  const positiveBatches = inventoryBatches.filter((batch) => finite(batch?.quantity, 0) > 0);
  const expiredBatches = validDate ? positiveBatches.filter((batch) => {
    const expiry = String(batch?.expires_on || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(expiry) && daysBetween(asOfDate, expiry) > 0;
  }) : [];
  const expiringBatches = validDate ? positiveBatches.filter((batch) => {
    const expiry = String(batch?.expires_on || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return false;
    const daysUntilExpiry = daysBetween(expiry, asOfDate);
    return daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 30;
  }) : [];
  const insights = [];
  if (overdue.length) insights.push({
    type: "overdue_receivables",
    severity: "medium",
    count: overdue.length,
    title: "Overdue invoices need review",
    recommendation: "Review the overdue invoice list and follow up through the normal customer process.",
  });
  if (lowStock.length) insights.push({
    type: "low_stock",
    severity: "medium",
    count: lowStock.length,
    title: "Some stock items are at or below their reorder threshold",
    recommendation: "Review low-stock items and plan replenishment using verified supplier and purchase-order details.",
  });
  if (expiredBatches.length) insights.push({
    type: "expired_inventory",
    severity: "high",
    count: expiredBatches.length,
    title: "Positive-quantity inventory batches are past their expiry date",
    recommendation: "Review and isolate expired batches according to the workspace's inventory policy before any sale or use.",
  });
  if (expiringBatches.length) insights.push({
    type: "expiring_inventory",
    severity: "medium",
    count: expiringBatches.length,
    title: "Inventory batches expire within 30 days",
    recommendation: "Review expiry dates and stock rotation plans.",
  });
  if (overduePurchaseOrders.length) insights.push({
    type: "overdue_purchase_orders",
    severity: "medium",
    count: overduePurchaseOrders.length,
    title: "Purchase orders are past their expected date",
    recommendation: "Review outstanding purchase orders and confirm delivery status with the supplier.",
  });
  const movementTypes = stockMovements.reduce((counts, item) => {
    const type = String(item?.movement_type || "unknown").slice(0, 40);
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  return {
    insights,
    receivables: {
      openInvoiceCount: openInvoices.length,
      overdueInvoiceCount: overdue.length,
      overdueAgeBuckets: {
        "1_7_days": overdue.filter((item) => item.daysOverdue <= 7).length,
        "8_30_days": overdue.filter((item) => item.daysOverdue >= 8 && item.daysOverdue <= 30).length,
        "over_30_days": overdue.filter((item) => item.daysOverdue > 30).length,
      },
      oldestOverdueDays: overdue.length ? Math.max(...overdue.map((item) => item.daysOverdue)) : 0,
    },
    purchasing: {
      openOrderCount: openPurchaseOrders.length,
      overdueExpectedOrderCount: overduePurchaseOrders.length,
      overdueOrders: overduePurchaseOrders.slice(0, 30).map((order) => ({
        supplier: String(order?.supplier_name || ""),
        reference: String(order?.supplier_reference || order?.id || ""),
        expectedDate: String(order?.expected_date || ""),
        daysOverdue: daysBetween(asOfDate, String(order?.expected_date || "")),
      })),
    },
    inventory: {
      lowStockCount: lowStock.length,
      lowStockItems: lowStock,
      movementRecordCount: stockMovements.length,
      movementTypes,
      batchRecordCount: inventoryBatches.length,
      expiredBatchCount: expiredBatches.length,
      expiringWithin30DaysCount: expiringBatches.length,
    },
    caveats: [
      "Receivables are counts only; monetary values are intentionally not combined across currencies.",
      "Only loaded records are analyzed. The caller must disclose context limits and unavailable modules.",
      "Low-stock flags use each item's configured threshold, defaulting to 5 only when no threshold is present.",
    ],
  };
}
