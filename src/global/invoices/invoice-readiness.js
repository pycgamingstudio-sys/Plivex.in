import { GLOBAL_COUNTRY_CURRENCIES } from "../tax/invoice-tax-integration.js";

export const GLOBAL_COMMERCIAL_INVOICE_COUNTRIES = Object.freeze(["US", "GB", "AE", "CA", "AU", "SG"]);

export function resolveGlobalInvoiceContext(account) {
  const countryCode = String(account?.country_code || "").trim().toUpperCase();
  const currencyCode = String(account?.currency_code || "").trim().toUpperCase();
  const expectedCurrency = GLOBAL_COUNTRY_CURRENCIES[countryCode] || "";
  if (!GLOBAL_COMMERCIAL_INVOICE_COUNTRIES.includes(countryCode)) {
    return { ok:false, reason:"unsupported_country", countryCode, currencyCode:"" };
  }
  if (!currencyCode || currencyCode !== expectedCurrency) {
    return { ok:false, reason:"workspace_currency_mismatch", countryCode, currencyCode:"", expectedCurrency };
  }
  return { ok:true, countryCode, currencyCode:expectedCurrency };
}

export function canIssueCommercialInvoice({ workspaceReady, issuanceReady, status, sellerProfileReady }) {
  return workspaceReady === true && issuanceReady === true && status === "draft" && sellerProfileReady === true;
}

export function getGlobalInvoiceDocumentTitle(snapshot = {}, status = "draft") {
  if (status === "draft" || snapshot.document_status === "draft") return "DRAFT INVOICE";
  if (snapshot.document_type === "commercial_invoice") return "COMMERCIAL INVOICE";
  if (snapshot.tax_status === "calculated") return "TAX INVOICE";
  return "INVOICE";
}

export function getGlobalInvoiceTaxDisclosure(snapshot = {}) {
  if (typeof snapshot.tax_disclosure === "string" && snapshot.tax_disclosure.trim()) return snapshot.tax_disclosure;
  if (snapshot.tax_treatment === "reverse-charge" || snapshot.reverse_charge_buyer_accounting === true) {
    return "Reverse charge applies under the selected verified rule. The buyer accounts for the tax; it is not added to the seller's payable invoice total. Confirm buyer registration and transaction eligibility.";
  }
  if (snapshot.tax_status === "calculated") return "Tax details are recorded in the issued invoice snapshot.";
  return "Tax has not been calculated or validated by Plivex. Confirm the applicable treatment with a qualified adviser.";
}
