/**
 * Country-aware product/service tax classification.
 *
 * Classification is explicitly supplied/reviewed by the business. Plivex does
 * not infer legal taxability from product names, descriptions, HSN/SAC, SKU or
 * AI output. "Unknown" always blocks tax calculation and invoice issuance.
 */
export const PRODUCT_TAX_CLASSIFICATION_VERSION = "2026.11.1";

export const TAX_TREATMENTS = Object.freeze({
  IN:["standard","nil_rated","exempt","non_gst","reverse_charge","unknown"],
  US:["taxable","exempt","non_taxable","unknown"],
  GB:["standard_rated","reduced_rated","zero_rated","exempt","outside_scope","reverse_charge","unknown"],
  AE:["standard_rated","zero_rated","exempt","outside_scope","reverse_charge","unknown"],
  CA:["taxable","zero_rated","exempt","outside_scope","gst_hst_only","pst_qst_only","unknown"],
  AU:["taxable","gst_free","input_taxed","out_of_scope","unknown"],
  SG:["standard_rated","zero_rated","exempt","out_of_scope","reverse_charge","unknown"],
});

const CLASSIFICATION_FIELDS = Object.freeze({
  IN:["supplyType","hsnOrSac","gstTreatment","placeOfSupply","reverseCharge"],
  US:["supplyType","productTaxCategory","destinationState","localJurisdiction","exemptionCertificateId"],
  GB:["supplyType","vatCommodityCategory","vatTreatment","placeOfSupply","reverseCharge"],
  AE:["supplyType","vatTreatment","designatedZoneStatus","placeOfSupply","reverseCharge"],
  CA:["supplyType","productTaxCategory","destinationProvince","pstQstTreatment","placeOfSupply"],
  AU:["supplyType","gstTreatment","exportOrConnectedWithAustralia","placeOfSupply"],
  SG:["supplyType","gstTreatment","internationalServiceOrExport","placeOfSupply","reverseCharge"],
});

export function getAllowedTaxTreatments(countryCode) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  return TAX_TREATMENTS[code] ? [...TAX_TREATMENTS[code]] : [];
}
export function getRequiredClassificationFields(countryCode) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  return CLASSIFICATION_FIELDS[code] ? [...CLASSIFICATION_FIELDS[code]] : [];
}
export function validateProductTaxClassification(input) {
  if (!input || typeof input !== "object") return {ok:false,code:"CLASSIFICATION_INPUT_REQUIRED"};
  const countryCode = typeof input.countryCode === "string" ? input.countryCode.trim().toUpperCase() : "";
  const treatment = typeof input.treatment === "string" ? input.treatment.trim().toLowerCase() : "";
  const allowed = getAllowedTaxTreatments(countryCode);
  if (!allowed.length) return {ok:false,code:"COUNTRY_CLASSIFICATION_NOT_CONFIGURED"};
  if (!allowed.includes(treatment) || treatment === "unknown") return {ok:false,code:"TAX_TREATMENT_UNRESOLVED",allowedTreatments:allowed};
  if (input.reviewedByBusiness !== true || input.reviewedOn == null || !/^\d{4}-\d{2}-\d{2}$/.test(input.reviewedOn)) {
    return {ok:false,code:"BUSINESS_CLASSIFICATION_REVIEW_REQUIRED",allowedTreatments:allowed};
  }
  const fields = getRequiredClassificationFields(countryCode);
  const missingFields = fields.filter(field => input[field] === undefined || input[field] === null || input[field] === "");
  if (missingFields.length) return {ok:false,code:"CLASSIFICATION_FIELDS_MISSING",missingFields};
  if (countryCode === "IN" && !/^[0-9A-Za-z]{4,8}$/.test(String(input.hsnOrSac))) {
    return {ok:false,code:"HSN_SAC_FORMAT_INVALID"};
  }
  if (countryCode === "US" && treatment === "exempt" && !input.exemptionCertificateId) {
    return {ok:false,code:"EXEMPTION_CERTIFICATE_REFERENCE_REQUIRED"};
  }
  return {
    ok:true,status:"classification_recorded_requires_rule_match",
    countryCode,treatment,classificationVersion:PRODUCT_TAX_CLASSIFICATION_VERSION,
    reviewedByBusiness:true,reviewedOn:input.reviewedOn,
    classificationSnapshot:Object.fromEntries(fields.map(field=>[field,input[field]])),
    taxCalculationEnabled:false,
    note:"Classification is recorded, but a separate active jurisdiction-specific tax rule is still required before calculation or issuance.",
  };
}
