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
      "number", "client_name", "business_name", "issue_date", "due_date", "is_draft",
      "currency", "status", "is_draft", "subtotal", "discount", "tax_value", "cgst", "sgst", "igst", "total",
    ]),
    invoice_snapshot: {
      business: pick(business, ["name", "address", "gstin", "locale", "countryLocale", "taxRegistrationNumber", "taxRegistrationType", "taxRegistrationStatus", "taxRegistrationEffectiveFrom", "registeredJurisdiction"]),
      client: pick(client, ["name", "company", "address", "gstin"]),
      items: (items.length ? items : (Array.isArray(invoice?.invoice_items) ? invoice.invoice_items : []))
        .map((item) => pick(item, ["description", "quantity", "rate", "gstRate"])),
      ...pick(snapshot, ["notes", "terms", "globalTax", "globalTaxCalculation", "globalTaxProfileSnapshot", "seller", "buyer", "document_type", "document_status", "tax_status", "tax_disclosure", "country_code", "currency_code", "locale_code", "invoice_number", "issue_date", "due_date", "subtotal_minor", "discount_minor", "tax_minor", "total_minor"]),
      ...(snapshot.shareUpiPayment === true && typeof snapshot.upiId === "string" ? { upiId: snapshot.upiId } : {}),
    },
    invoice_items: Array.isArray(invoice?.invoice_items)
      ? invoice.invoice_items.map((item) => pick(item, ["description", "quantity", "rate"]))
      : [],
  };
}
