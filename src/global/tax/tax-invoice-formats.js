/**
 * Country-specific tax invoice presentation metadata.
 * These are rendering labels/field requirements, not legal-compliance certification.
 * India remains mapped to the existing GST invoice path.
 */
const FORMATS = Object.freeze({
  IN: {
    title: "Tax Invoice", taxLabel: "GST", registrationLabel: "GSTIN",
    itemTaxLabel: "GST rate", jurisdictionLabel: "Place of supply",
    requiredSellerFields: ["name", "address", "gstin"],
    taxComponents: ["CGST", "SGST/UTGST", "IGST", "Cess"],
    classificationLabel: "HSN/SAC",
  },
  US: {
    title: "Sales Tax Invoice", taxLabel: "Sales tax", registrationLabel: "Sales tax permit number",
    itemTaxLabel: "Sales tax", jurisdictionLabel: "Ship-to / place of sale",
    requiredSellerFields: ["name", "address", "taxRegistrationNumber"],
    taxComponents: ["State tax", "County tax", "City tax", "Special district tax"],
    classificationLabel: "Product/service tax category",
  },
  GB: {
    title: "VAT Invoice", taxLabel: "VAT", registrationLabel: "VAT registration number",
    itemTaxLabel: "VAT rate", jurisdictionLabel: "Place of supply",
    requiredSellerFields: ["name", "address", "taxRegistrationNumber"],
    taxComponents: ["VAT"],
    classificationLabel: "VAT treatment",
  },
  AE: {
    title: "Tax Invoice", taxLabel: "VAT", registrationLabel: "TRN",
    itemTaxLabel: "VAT rate", jurisdictionLabel: "Place of supply",
    requiredSellerFields: ["name", "address", "taxRegistrationNumber"],
    taxComponents: ["VAT"],
    classificationLabel: "VAT treatment",
  },
  CA: {
    title: "GST/HST Invoice", taxLabel: "GST/HST", registrationLabel: "GST/HST account number",
    itemTaxLabel: "GST/HST/PST/QST rate", jurisdictionLabel: "Province / place of supply",
    requiredSellerFields: ["name", "address", "taxRegistrationNumber"],
    taxComponents: ["GST", "HST", "PST", "QST"],
    classificationLabel: "Supply tax treatment",
  },
  AU: {
    title: "Tax Invoice", taxLabel: "GST", registrationLabel: "ABN",
    itemTaxLabel: "GST treatment", jurisdictionLabel: "Supply location",
    requiredSellerFields: ["name", "address", "abn"],
    taxComponents: ["GST"],
    classificationLabel: "GST-free / input-taxed / taxable",
  },
  SG: {
    title: "Tax Invoice", taxLabel: "GST", registrationLabel: "GST registration number",
    itemTaxLabel: "GST rate", jurisdictionLabel: "Place of supply",
    requiredSellerFields: ["name", "address", "taxRegistrationNumber"],
    taxComponents: ["GST"],
    classificationLabel: "Standard / zero-rated / exempt",
  },
});

export function getTaxInvoiceFormat(countryCode) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  const format = FORMATS[code];
  return format ? { countryCode: code, ...format, requiredSellerFields: [...format.requiredSellerFields], taxComponents: [...format.taxComponents] } : null;
}

export function validateTaxInvoiceSellerFields(countryCode, seller = {}) {
  const format = getTaxInvoiceFormat(countryCode);
  if (!format) return { ok: false, missing: ["supported country"] };
  const missing = format.requiredSellerFields.filter((field) => !String(seller[field] ?? "").trim());
  return { ok: missing.length === 0, missing };
}
