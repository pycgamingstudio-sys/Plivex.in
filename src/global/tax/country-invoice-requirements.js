/**
 * Country invoice field checklist and product guardrails.
 * This is a validation aid, not a legal opinion or compliance certification.
 * It intentionally returns review-required for countries whose invoice rules
 * need jurisdiction-specific treatment not implemented by this product.
 */
const RULES = Object.freeze({
  GB: { currency: "GBP", required: ["invoiceNumber", "issueDate", "taxPointDate", "sellerName", "sellerAddress", "sellerRegistrationNumber", "buyerName", "buyerAddress", "lineItems", "netAmountMinor", "taxAmountMinor", "totalAmountMinor"], review: "Standard VAT invoice checklist only; special schemes and exceptions need review." },
  AE: { currency: "AED", required: ["invoiceNumber", "issueDate", "supplyDate", "sellerName", "sellerAddress", "sellerRegistrationNumber", "buyerName", "lineItems", "netAmountMinor", "taxAmountMinor", "totalAmountMinor"], review: "Foreign-currency tax invoice conversion and UAE-specific line rounding are not enabled; AED-only tax invoices." },
  AU: { currency: "AUD", required: ["invoiceNumber", "issueDate", "sellerName", "sellerAddress", "sellerRegistrationNumber", "lineItems", "taxAmountMinor", "totalAmountMinor"], review: "Buyer identity and ABN are required for taxable sales of AUD 1,000 or more." },
  SG: { currency: "SGD", required: ["invoiceNumber", "issueDate", "sellerName", "sellerAddress", "sellerRegistrationNumber", "lineItems", "netAmountMinor", "taxAmountMinor", "totalAmountMinor"], review: "Simplified tax invoice treatment is not automatically selected; use full invoice checklist." },
  US: { currency: "USD", required: [], review: "Sales-tax invoice disclosures vary by state and locality; jurisdiction-specific review required." },
  CA: { currency: "CAD", required: [], review: "GST/HST/PST invoice disclosures vary by place of supply and province; jurisdiction-specific review required." },
});
const present = (value) => value !== undefined && value !== null && !(typeof value === "string" && !value.trim());
export function getCountryInvoiceRequirements(countryCode) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  if (code === "IN") return { countryCode: code, status: "legacy_path", required: [], note: "Use the existing India GST invoice implementation." };
  const rule = RULES[code];
  return rule ? { countryCode: code, status: ["US", "CA"].includes(code) ? "jurisdiction_review" : "limited_checklist", ...rule } : null;
}
export function validateCountryInvoice(countryCode, invoice) {
  const requirements = getCountryInvoiceRequirements(countryCode);
  if (!requirements) return { ok: false, status: "needs_review", code: "UNSUPPORTED_COUNTRY" };
  if (requirements.status === "legacy_path") return { ok: false, status: "needs_review", code: "INDIA_LEGACY_ADAPTER_REQUIRED", message: requirements.note };
  if (requirements.status === "jurisdiction_review") return { ok: false, status: "needs_review", code: "JURISDICTION_INVOICE_REVIEW_REQUIRED", message: requirements.note };
  if (!invoice || typeof invoice !== "object" || Array.isArray(invoice)) return { ok: false, status: "needs_review", code: "INVALID_INVOICE" };
  if (invoice.currencyCode !== requirements.currency) return { ok: false, status: "needs_review", code: "INVOICE_CURRENCY_MISMATCH" };
  if (!Array.isArray(invoice.lineItems) || invoice.lineItems.length === 0
    || invoice.lineItems.some((line) => !line || typeof line !== "object" || !present(line.description)
      || !Number.isFinite(line.quantity) || line.quantity <= 0
      || !Number.isSafeInteger(line.unitPriceMinor) || line.unitPriceMinor < 0)) {
    return { ok: false, status: "needs_review", code: "INVALID_LINE_ITEMS" };
  }
  if (countryCode === "AE" && invoice.currencyCode !== "AED") return { ok: false, status: "needs_review", code: "AE_FOREIGN_CURRENCY_TAX_INVOICE_UNSUPPORTED" };
  if (countryCode === "AU" && Number.isSafeInteger(invoice.totalAmountMinor) && invoice.totalAmountMinor >= 100000
    && (!present(invoice.buyerName) || !present(invoice.buyerRegistrationNumber))) {
    return { ok: false, status: "needs_review", code: "AU_BUYER_DETAILS_REQUIRED" };
  }
  const missing = requirements.required.filter((field) => !present(invoice[field]));
  if (missing.length) return { ok: false, status: "needs_review", code: "MISSING_INVOICE_FIELDS", missing };
  return { ok: true, status: "checklist_passed", countryCode, currencyCode: requirements.currency, limitations: requirements.review };
}
