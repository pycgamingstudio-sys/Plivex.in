const pick = (source, keys) => Object.fromEntries(
  keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]])
);

/** Return only fields rendered by the public invoice page. */
export function sanitizePublicInvoice(invoice) {
  const snapshot = invoice?.invoice_snapshot && typeof invoice.invoice_snapshot === "object"
    ? invoice.invoice_snapshot
    : {};
  const business = snapshot.business && typeof snapshot.business === "object" ? snapshot.business : {};
  const client = snapshot.client && typeof snapshot.client === "object" ? snapshot.client : {};
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];

  return {
    ...pick(invoice, [
      "number", "client_name", "business_name", "issue_date", "due_date",
      "currency", "status", "subtotal", "cgst", "sgst", "igst", "total",
    ]),
    invoice_snapshot: {
      business: pick(business, ["name", "address", "gstin", "locale", "countryLocale"]),
      client: pick(client, ["name", "company", "address", "gstin"]),
      items: items.map((item) => pick(item, ["id", "description", "quantity", "rate", "gstRate"])),
      ...pick(snapshot, ["notes", "terms"]),
    },
    invoice_items: Array.isArray(invoice?.invoice_items)
      ? invoice.invoice_items.map((item) => pick(item, ["id", "description", "quantity", "rate"]))
      : [],
  };
}
