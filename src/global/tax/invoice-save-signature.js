/**
 * Stable idempotency signature for invoice persistence.
 * Global tax settings and the workspace tax profile are part of the saved
 * invoice snapshot, so changing either must invalidate the save cache.
 */
export function invoiceSaveSignature(inv) {
  return JSON.stringify([
    inv.client?.name,
    inv.client?.email,
    inv.business?.name,
    inv.issueDate,
    inv.dueDate,
    inv.currency,
    inv.taxMode,
    inv.taxRate,
    inv.discountType,
    inv.discount,
    inv.notes,
    inv.terms,
    (inv.items || []).map((item) => [item.description, item.quantity, item.rate, item.gstRate, item.hsnSac || null]),
    inv.business?.address,
    inv.globalTax || null,
    inv.globalTaxProfileSnapshot || null,
    inv.globalTaxCalculation || null,
  ]);
}
