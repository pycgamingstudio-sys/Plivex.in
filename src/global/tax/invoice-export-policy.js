/**
 * Draft exports are customer-facing working documents, not issued tax invoices.
 * Tax readiness is therefore required for issuance, but not for a clearly marked
 * Global draft PDF. Core invoice fields are still validated by the editor.
 */
export function getGlobalInvoiceTaxValidationError({ countryCode, taxCalculation, allowDraftExport = false } = {}) {
  const country = String(countryCode || "").trim().toUpperCase();
  if (!country || country === "IN" || allowDraftExport) return "";
  if (taxCalculation?.ok === true) return "";
  return taxCalculation?.message || "Complete the tax details before issuing this invoice.";
}
