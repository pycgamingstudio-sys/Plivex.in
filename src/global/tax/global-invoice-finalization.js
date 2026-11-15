/**
 * Part 11: final invoice-tax snapshot and e-invoicing readiness boundary.
 * No tax certification or invoice transmission is performed here.
 */
const COUNTRIES = Object.freeze(["IN", "US", "GB", "AE", "CA", "AU", "SG"]);
const E_INVOICE = Object.freeze({
  IN: Object.freeze({ countryCode:"IN", status:"legacy_india_path", network:"India GST/e-invoice processes", submission:"not_performed_by_global_adapter", note:"Continue through the existing India GST and separately configured government/IRP workflow.", source:"https://einvoice.gst.gov.in/" }),
  US: Object.freeze({ countryCode:"US", status:"not_configured", network:null, submission:"disabled", note:"No nationwide Plivex e-invoice transmission adapter is configured; review applicable state and sector requirements.", source:"https://www.irs.gov/businesses" }),
  GB: Object.freeze({ countryCode:"GB", status:"future_requirement_tracked", network:"Peppol roadmap", mandatoryFrom:"2029-04-01", submission:"disabled", note:"Mandatory VAT e-invoicing is scheduled from 1 April 2029. No Peppol transmission is enabled.", source:"https://www.gov.uk/government/publications/vat-electronic-invoicing/e-invoicing-requirements" }),
  AE: Object.freeze({ countryCode:"AE", status:"phased_requirement_provider_required", network:"UAE accredited service provider framework", submission:"disabled", note:"Structured e-invoices require the UAE framework and eligible/accredited service provider. No provider integration is configured.", source:"https://mof.gov.ae/en/about-us/initiatives/einvoicing/" }),
  CA: Object.freeze({ countryCode:"CA", status:"not_configured", network:null, submission:"disabled", note:"No nationwide Plivex e-invoice transmission adapter is configured; review applicable provincial, public-sector and customer requirements.", source:"https://www.canada.ca/en/revenue-agency.html" }),
  AU: Object.freeze({ countryCode:"AU", status:"network_available_in_ecosystem", network:"Peppol eInvoicing", submission:"disabled", note:"Peppol exists in the Australian ecosystem, but Plivex has no registered access-point integration configured.", source:"https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/einvoicing" }),
  SG: Object.freeze({ countryCode:"SG", status:"phased_requirement_provider_required", network:"InvoiceNow (Peppol)", submission:"disabled", note:"GST InvoiceNow obligations are phased by registration/cohort and implementation date. No InvoiceNow-ready access point is configured.", source:"https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/gst-invoicenow-requirement" }),
});
const COUNTRY_CURRENCY = Object.freeze({ IN:"INR", US:"USD", GB:"GBP", AE:"AED", CA:"CAD", AU:"AUD", SG:"SGD" });
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};
const fail = (code, message) => ({ ok:false, status:"needs_review", code, message });
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};
export function getEInvoiceReadiness(countryCode) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  const capability = Object.hasOwn(E_INVOICE, code) ? E_INVOICE[code] : null;
  if (!capability) return { ok:false, status:"not_configured", code:"EINVOICE_COUNTRY_NOT_CONFIGURED" };
  return { ok:true, ...capability, transmissionEnabled:false };
}
/** Freeze only a successful, country-matched, source-backed tax calculation. */
export function createGlobalInvoiceTaxSnapshot(input) {
  if (!isRecord(input)) return fail("SNAPSHOT_INPUT_REQUIRED", "Invoice tax snapshot input is required.");
  const countryCode = typeof input.countryCode === "string" ? input.countryCode.trim().toUpperCase() : "";
  if (!COUNTRIES.includes(countryCode)) return fail("SNAPSHOT_COUNTRY_UNSUPPORTED", "A supported workspace country is required.");
  if (countryCode === "IN") return fail("INDIA_LEGACY_PATH_REQUIRED", "India must retain its existing GST invoice and snapshot path.");
  if (!validDate(input.invoiceDate)) return fail("SNAPSHOT_INVOICE_DATE_INVALID", "A valid invoice date is required.");
  const result = input.taxResult;
  if (!isRecord(result) || result.ok !== true || result.status !== "calculated" || result.countryCode !== countryCode) {
    return fail("TAX_RESULT_NOT_ISSUABLE", "Only a successful, country-matched calculated tax result can be snapshotted. Manual estimates and review results remain drafts.");
  }
  if (result.currencyCode !== COUNTRY_CURRENCY[countryCode] || result.currencyMinorUnits !== 2) return fail("SNAPSHOT_CURRENCY_INVALID", "Tax snapshot currency and precision must match the workspace country.");
  const rule = result.ruleSnapshot;
  if (!isRecord(rule) || !String(rule.id || "").trim() || !String(rule.version || "").trim()
    || !/^https:\/\//.test(String(rule.source || "")) || !validDate(rule.effectiveFrom)
    || input.invoiceDate < rule.effectiveFrom
    || (rule.effectiveTo && (!validDate(rule.effectiveTo) || input.invoiceDate > rule.effectiveTo))) {
    return fail("RULE_PROVENANCE_REQUIRED", "A source-backed, versioned rule effective on the invoice date is required.");
  }
  if (!Number.isSafeInteger(result.taxableMinor) || result.taxableMinor < 0
    || !Number.isSafeInteger(result.taxMinor) || result.taxMinor < 0
    || !Number.isSafeInteger(result.totalMinor) || result.totalMinor !== result.taxableMinor + result.taxMinor
    || !Array.isArray(result.components) || result.components.length < 1
    || result.components.some((item) => !isRecord(item) || !String(item.id || "").trim()
      || !Number.isSafeInteger(item.amountMinor) || item.amountMinor < 0)) {
    return fail("TAX_TOTALS_INVALID", "Tax totals and component amounts must be consistent integer minor-unit values.");
  }
  const componentTotal = result.components.reduce((sum, item) => sum + item.amountMinor, 0);
  if (componentTotal !== result.taxMinor) return fail("TAX_COMPONENT_TOTAL_MISMATCH", "Tax component amounts do not match the calculated tax total.");
  const snapshot = {
    schemaVersion:"1", countryCode, invoiceDate:input.invoiceDate,
    currencyCode:result.currencyCode, currencyMinorUnits:result.currencyMinorUnits,
    engineVersion:result.engineVersion || null, rule:{ ...rule },
    treatment:result.treatment, priceMode:result.priceMode,
    taxableMinor:result.taxableMinor, taxMinor:result.taxMinor, totalMinor:result.totalMinor,
    components:result.components.map((item) => ({ ...item })),
    sellerRegistrationEvidence:result.registrationEvidence || "not_recorded",
    capturedAt:typeof input.capturedAt === "string" ? input.capturedAt : null,
    immutable:true,
  };
  return { ok:true, status:"snapshot_ready", snapshot:deepFreeze(snapshot) };
}
/** No provider/network integration is enabled in this release. */
export function prepareEInvoiceSubmission(countryCode, invoiceSnapshot) {
  const readiness = getEInvoiceReadiness(countryCode);
  if (!readiness.ok) return readiness;
  if (!isRecord(invoiceSnapshot) || invoiceSnapshot.immutable !== true || invoiceSnapshot.countryCode !== readiness.countryCode) {
    return fail("ISSUED_INVOICE_SNAPSHOT_REQUIRED", "A matching immutable issued-invoice snapshot is required.");
  }
  return {
    ok:false, status:"provider_integration_required", code:"EINVOICE_PROVIDER_NOT_CONFIGURED",
    countryCode:readiness.countryCode, network:readiness.network, transmissionEnabled:false,
    message:"The required government network or accredited/access-point provider is not configured. No invoice was transmitted.",
  };
}
