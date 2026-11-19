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
    total: keys.length <= 1 ? (keys.length ? byGroup[keys[0]] : 0) : null,
    byGroup,
    mixedGroups: keys.length > 1,
  };
}

/**
 * @param {{
 *   invoices?: Array<Record<string, unknown>>,
 *   stock?: Array<Record<string, unknown>>,
 *   stockMovements?: Array<Record<string, unknown>>,
 *   asOfDate?: string
 * }} input
 */
export function buildAssistantBusinessAnalytics(input = {}) {
  const { invoices = [], stock = [], stockMovements = [], asOfDate } = input;
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
  const movementTypes = stockMovements.reduce((counts, item) => {
    const type = String(item?.movement_type || "unknown").slice(0, 40);
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  return {
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
    inventory: {
      lowStockCount: lowStock.length,
      lowStockItems: lowStock,
      movementRecordCount: stockMovements.length,
      movementTypes,
    },
    caveats: [
      "Receivables are counts only; monetary values are intentionally not combined across currencies.",
      "Only loaded records are analyzed. The caller must disclose context limits and unavailable modules.",
      "Low-stock flags use each item's configured threshold, defaulting to 5 only when no threshold is present.",
    ],
  };
}
