import { calculateGlobalTax } from "./global-tax-engine.js";
import { createGlobalInvoiceTaxSnapshot, getEInvoiceReadiness } from "./global-invoice-finalization.js";
import { calculateManualTax } from "./manual-tax-calculator.js";
import { getTaxInvoiceFormat, validateTaxInvoiceSellerFields } from "./tax-invoice-formats.js";
import { isSupportedManualTaxTreatment, normalizeManualTaxTreatment } from "./tax-treatment-policy.js";

export const GLOBAL_COUNTRY_CURRENCIES = Object.freeze({
  IN: "INR", US: "USD", GB: "GBP", AE: "AED", CA: "CAD", AU: "AUD", SG: "SGD",
});

/** Global invoices always use the selected workspace country's currency. */
export function resolveInvoiceCurrencyForWorkspace(countryCode, preferredCurrency = "INR") {
  const code = String(countryCode || "").trim().toUpperCase();
  if (code === "IN") return preferredCurrency || "INR";
  return GLOBAL_COUNTRY_CURRENCIES[code] || "";
}

const MINOR_UNITS = Object.freeze({ INR: 2, USD: 2, GBP: 2, AED: 2, CAD: 2, AUD: 2, SGD: 2 });
const US_JURISDICTIONS = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);
const CA_JURISDICTIONS = new Set(["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"]);
const fail = (code, message) => ({ ok: false, status: "needs_review", code, message });
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

function amountMinor(invoice) {
  const subtotal = (invoice.items || []).reduce((sum, item) => {
    const quantity = Number(item.quantity);
    const rate = Number(item.rate);
    if (!Number.isFinite(quantity) || !Number.isFinite(rate) || quantity < 0 || rate < 0) return NaN;
    return sum + quantity * rate;
  }, 0);
  if (!Number.isFinite(subtotal) || !Number.isSafeInteger(Math.round(subtotal * 100))) return NaN;
  const discount = Math.max(0, Number(invoice.discount) || 0);
  const discountValue = invoice.discountType === "percent"
    ? subtotal * Math.min(100, discount) / 100
    : Math.min(subtotal, discount);
  return Math.round(Math.max(0, subtotal - discountValue) * 100);
}

/**
 * Shared frontend/Edge Function integration contract. Workspace profile values
 * are user-supplied; the UI never represents them as authority-verified.
 */
export function calculateInvoiceGlobalTax(invoice, workspaceProfile) {
  const countryCode = String(workspaceProfile?.countryCode || "").trim().toUpperCase();
  if (countryCode === "IN") return { ok: true, status: "india_legacy", countryCode };
  if (!Object.hasOwn(GLOBAL_COUNTRY_CURRENCIES, countryCode)) {
    return fail("WORKSPACE_COUNTRY_REQUIRED", "Choose a supported workspace country before calculating tax.");
  }

  const config = invoice?.globalTax || { mode: ["US", "CA"].includes(countryCode) ? "manual" : "automatic", priceMode: "exclusive" };
  if (config.countryCode && config.countryCode !== countryCode) return fail("COUNTRY_PROFILE_MISMATCH", "Invoice tax country does not match the saved workspace country.");
  const mode = config.mode;
  const currencyCode = String(invoice?.currency || "").trim().toUpperCase();
  if (currencyCode !== GLOBAL_COUNTRY_CURRENCIES[countryCode] || MINOR_UNITS[currencyCode] === undefined) {
    return fail("CURRENCY_MISMATCH", "Invoice currency must match the workspace country. Currency conversion is not performed.");
  }
  const issueDate = String(invoice?.issueDate || "");
  if (!validDate(issueDate)) return fail("INVOICE_DATE_REQUIRED", "A valid invoice date is required for tax effective-date checks.");

  // A commercial invoice with no tax charged is distinct from zero-rated or exempt
  // tax treatment. It requires an explicit business attestation and never creates
  // a tax calculation/snapshot or claims that Plivex verified legal tax status.
  if (config.taxMode === "no_tax") {
    if (config.noTaxConfirmed !== true) {
      return fail("NO_TAX_CONFIRMATION_REQUIRED", "Confirm that you have checked and are not required to charge this tax on this transaction.");
    }
    const amount = amountMinor(invoice);
    if (!Number.isSafeInteger(amount) || amount < 0) return fail("INVALID_AMOUNT", "Invoice amount is outside supported calculation limits.");
    return {
      ok: true,
      status: "not_applicable",
      mode: "no_tax",
      countryCode,
      currencyCode,
      invoiceDate: issueDate,
      taxableMinor: amount,
      taxMinor: 0,
      totalMinor: amount,
      components: [],
      taxSnapshot: null,
      warning: null,
      disclosure: "No tax charged — commercial invoice. Tax status is based on the business's confirmation and has not been independently verified by Plivex.",
    };
  }

  const registrationNumber = String(workspaceProfile?.registrationNumber || "").trim();
  const registrationStatus = String(workspaceProfile?.registrationStatus || "unregistered");
  const registrationEffectiveFrom = String(workspaceProfile?.registrationEffectiveFrom || "");
  if (registrationStatus !== "registered" || !registrationNumber || !validDate(registrationEffectiveFrom)) {
    return fail("REGISTRATION_UNVERIFIED", "Enter an active registration number, registered status and effective date in workspace settings. These details are self-declared and are not independently verified by Plivex.");
  }
  if (issueDate < registrationEffectiveFrom) {
    return fail("REGISTRATION_NOT_EFFECTIVE", "Invoice date is before the saved tax registration effective date.");
  }
  if (config.taxDetailsConfirmed === false) {
    return fail("TAX_DETAILS_CONFIRMATION_REQUIRED", "Confirm the saved registration details, place of supply and tax category together.");
  }
  if (config.taxDetailsConfirmed !== true && config.registrationConfirmed !== true) {
    return fail("REGISTRATION_CONFIRMATION_REQUIRED", "Confirm the saved registration details and invoice tax details together.");
  }
  if (config.taxDetailsConfirmed !== true && config.placeOfSupplyConfirmed !== true) {
    return fail("PLACE_OF_SUPPLY_REQUIRED", "Enter and confirm the place of supply for this invoice.");
  }
  if (config.taxDetailsConfirmed !== true && config.taxCategoryConfirmed !== true) {
    return fail("TAX_CATEGORY_REQUIRED", "Select and confirm the goods/services tax category.");
  }
  if (!String(config.placeOfSupply || "").trim()) {
    return fail("PLACE_OF_SUPPLY_REQUIRED", "Enter the place of supply for this invoice.");
  }
  if (!String(config.taxCategory || "").trim()) {
    return fail("TAX_CATEGORY_REQUIRED", "Select the goods/services tax category.");
  }
  const selectedTreatment = String(config.taxTreatment || "standard").trim().toLowerCase();
  if (!["standard", "reduced", "zero-rated", "gst-free", "exempt", "out-of-scope"].includes(selectedTreatment)) {
    return fail("UNSUPPORTED_TAX_TREATMENT", "This tax treatment is not supported. Keep the invoice as a draft.");
  }
  const normalizedTreatment = selectedTreatment === "standard" ? "standard-rated" : selectedTreatment;
  if (mode === "manual" && (normalizedTreatment !== "standard-rated" || !isSupportedManualTaxTreatment(config.taxCategory))) {
    return fail("UNSUPPORTED_TAX_TREATMENT", "Manual rates support standard-rated tax only. Special treatments require an exact verified country/category rule.");
  }

  const amount = amountMinor(invoice);
  if (!Number.isSafeInteger(amount) || amount < 0) return fail("INVALID_AMOUNT", "Invoice amount is outside supported calculation limits.");
  const format = getTaxInvoiceFormat(countryCode);
  if (!format) return fail("INVOICE_FORMAT_UNAVAILABLE", "No tax invoice format is available for this country.");
  const sellerValidation = validateTaxInvoiceSellerFields(countryCode, {
    name: invoice?.business?.name,
    address: invoice?.business?.address,
    taxRegistrationNumber: registrationNumber,
    abn: registrationNumber,
  });
  if (!sellerValidation.ok) return fail("SELLER_FIELDS_REQUIRED", "Complete the country-required seller fields: " + sellerValidation.missing.join(", ") + ".");

  if (mode === "manual") {
    const components = Array.isArray(config.components) ? config.components : [];
    if (!components.length) return fail("MANUAL_COMPONENTS_REQUIRED", "Add at least one tax component and its rate.");
    if (components.some((item) => !String(item?.id || "").trim() || !String(item?.name || "").trim() || !Number.isInteger(Number(item.rateBps)) || Number(item.rateBps) <= 0 || Number(item.rateBps) > 10000)) return fail("MANUAL_COMPONENT_INVALID", "Every manual tax component needs a name and an explicit rate greater than 0% and no more than 100%. Zero-rated/exempt treatments need a separately verified rule.");
    if (countryCode === "US" || countryCode === "CA") {
      const jurisdiction = config.destinationJurisdiction || {};
      const required = countryCode === "US"
        ? ["state", "county", "city"]
        : ["province"];
      const destinationRegion = String(jurisdiction[countryCode === "US" ? "state" : "province"] || "").trim().toUpperCase();
      const registeredParts = String(workspaceProfile?.registeredJurisdiction || "").trim().toUpperCase().split("-");
      const sellerRegion = registeredParts[1] || "";
      const allowedRegions = countryCode === "US" ? US_JURISDICTIONS : CA_JURISDICTIONS;
      const sellerRegionValid = registeredParts.length === 2 && registeredParts[0] === countryCode && allowedRegions.has(sellerRegion);
      if (required.some((key) => !String(jurisdiction[key] || "").trim()) || !destinationRegion) {
        return fail("DESTINATION_JURISDICTION_REQUIRED", "Enter the required destination state/county/city or province/territory.");
      }
      if (!allowedRegions.has(destinationRegion) || !sellerRegionValid) {
        return fail("INVALID_JURISDICTION", "Enter valid destination and seller registration state/province codes for the selected country.");
      }
      if (config.collectionObligationAttested !== true) {
        return fail("COLLECTION_OBLIGATION_ATTESTATION_REQUIRED", "Attest that you have checked the collection obligation for this destination. Plivex does not independently verify nexus or collection duties.");
      }
    }
    const result = calculateManualTax({
      countryCode,
      currencyCode,
      currencyMinorUnits: MINOR_UNITS[currencyCode],
      amountMinor: amount,
      priceMode: config.priceMode,
      taxTreatment: normalizedTreatment,
      components: components.map((item) => ({
        id: String(item.id || ""),
        name: String(item.name || item.id || ""),
        rateBps: Number(item.rateBps),
      })),
      jurisdictionConfirmed: (countryCode === "US" || countryCode === "CA")
        ? config.collectionObligationAttested === true
        : true,
    });
    return result.ok
      ? { ...result, mode: "manual", countryCode, invoiceDate: issueDate, format, registrationEvidence: "user-attested", warning: result.warning + " Registration and collection-obligation details are user-attested and are not independently verified by Plivex." }
      : result;
  }

  if (mode !== "automatic") return fail("TAX_MODE_REQUIRED", "Choose automatic standard-rate calculation or enter manual rates.");
  if (countryCode === "US") {
    return fail("JURISDICTION_RULE_REQUIRED", "US state, county, city and special-district rates require an exact verified destination rule. Enter reviewed rates manually or leave this invoice unfinalized.");
  }
  if (countryCode === "CA" && !String(config.destinationJurisdiction?.province || "").trim()) {
    return fail("DESTINATION_JURISDICTION_REQUIRED", "Select the Canadian province or territory for the place-of-supply rate.");
  }
  if (countryCode === "CA" && config.collectionObligationAttested !== true) {
    return fail("COLLECTION_OBLIGATION_ATTESTATION_REQUIRED", "Confirm that you have checked whether your business must collect GST/HST in the selected destination province.");
  }
  if (countryCode === "CA" && ["BC", "MB", "SK"].includes(String(config.destinationJurisdiction?.province || "").trim().toUpperCase())) {
    const province = String(config.destinationJurisdiction.province).trim().toUpperCase();
    if (config.taxCategory !== `CA_${province}_PST_TAXABLE_GOODS`) {
      return fail("CANADIAN_PST_TAXABILITY_REQUIRED", "This province has a separate PST/RST. Confirm that every line is a taxable tangible good before Plivex applies that provincial component.");
    }
  }

  const result = calculateGlobalTax({
    countryCode,
    currencyCode,
    currencyMinorUnits: MINOR_UNITS[currencyCode],
    amountMinor: amount,
    invoiceDate: issueDate,
    sellerRegistration: {
      verified: false,
      attestedByUser: true,
      status: registrationStatus,
      registrationNumber,
      effectiveFrom: registrationEffectiveFrom,
      jurisdictions: [
        ...(workspaceProfile?.registeredJurisdiction ? [workspaceProfile.registeredJurisdiction] : []),
        
      ],
    },
    placeOfSupplyVerified: true,
    placeOfSupply: String(config.placeOfSupply).trim(),
    taxCategoryVerified: true,
    taxCategory: String(config.taxCategory).trim(),
    treatment: selectedTreatment,
    ...(countryCode === "CA" ? {
      jurisdictionId: String(config.destinationJurisdiction.province).trim().toUpperCase(),
      jurisdictionAttestedByUser: true,
      collectionObligationAttestedByUser: config.collectionObligationAttested === true,
    } : {}),
    priceMode: config.priceMode,
  });
  if (!result.ok) return result;
  const finalized = createGlobalInvoiceTaxSnapshot({
    countryCode, invoiceDate: issueDate, taxResult: result,
  });
  if (!finalized.ok) {
    return fail("TAX_SNAPSHOT_FINALIZATION_FAILED", "The calculated tax could not be frozen with its rule provenance. Keep this invoice as a draft and review the tax details.");
  }
  return {
    ...result,
    mode: "automatic",
    format,
    registrationEvidence: "user-attested",
    taxSnapshot: finalized.snapshot,
    eInvoiceReadiness: getEInvoiceReadiness(countryCode),
    warning: "The standard-rate rule is source-backed. Seller registration, place of supply and tax category are self-declared and are not independently verified by Plivex.",
  };
}
