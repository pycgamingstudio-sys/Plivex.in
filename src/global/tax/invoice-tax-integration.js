import { calculateGlobalTax } from "./global-tax-engine.js";
import { calculateManualTax } from "./manual-tax-calculator.js";
import { getTaxInvoiceFormat, validateTaxInvoiceSellerFields } from "./tax-invoice-formats.js";

export const GLOBAL_COUNTRY_CURRENCIES = Object.freeze({
  IN: "INR", US: "USD", GB: "GBP", AE: "AED", CA: "CAD", AU: "AUD", SG: "SGD",
});

/** Global invoices always use the selected workspace country's currency. */
export function resolveInvoiceCurrencyForWorkspace(countryCode, preferredCurrency = "INR") {
  const code = String(countryCode || "").trim().toUpperCase();
  return (code !== "IN" && GLOBAL_COUNTRY_CURRENCIES[code]) || preferredCurrency || "INR";
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

  const registrationNumber = String(workspaceProfile?.registrationNumber || "").trim();
  const registrationStatus = String(workspaceProfile?.registrationStatus || "unregistered");
  const registrationEffectiveFrom = String(workspaceProfile?.registrationEffectiveFrom || "");
  if (registrationStatus !== "registered" || !registrationNumber || !validDate(registrationEffectiveFrom)) {
    return fail("REGISTRATION_UNVERIFIED", "Enter an active registration number, registered status and effective date in workspace settings. These details are self-declared and are not independently verified by Plivex.");
  }
  if (issueDate < registrationEffectiveFrom) {
    return fail("REGISTRATION_NOT_EFFECTIVE", "Invoice date is before the saved tax registration effective date.");
  }
  if (config.registrationConfirmed !== true) {
    return fail("REGISTRATION_CONFIRMATION_REQUIRED", "Confirm that the saved registration details are accurate and active.");
  }
  if (config.placeOfSupplyConfirmed !== true || !String(config.placeOfSupply || "").trim()) {
    return fail("PLACE_OF_SUPPLY_REQUIRED", "Enter and confirm the place of supply for this invoice.");
  }
  if (config.taxCategoryConfirmed !== true || !String(config.taxCategory || "").trim()) {
    return fail("TAX_CATEGORY_REQUIRED", "Enter and confirm the goods/services tax category.");
  }
  if (mode !== "manual" && !/^standard(?:[- ]rated)?(?: supply)?$/i.test(String(config.taxCategory || "").trim())) {
    return fail("UNSUPPORTED_TAX_TREATMENT", "Automatic calculation currently supports only standard-rated supplies. Reduced, zero-rated, exempt and special treatments fail closed.");
  }
  if (mode === "manual" && /(zero[- ]rated|exempt|reduced|reverse[- ]charge|out[- ]of[- ]scope)/i.test(String(config.taxCategory || "").trim())) {
    return fail("UNSUPPORTED_TAX_TREATMENT", "Manual tax components do not support zero-rated, exempt, reduced, reverse-charge or out-of-scope treatments.");
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
      const registeredRegion = registeredParts[1] || "";
      const allowedRegions = countryCode === "US" ? US_JURISDICTIONS : CA_JURISDICTIONS;
      if (required.some((key) => !String(jurisdiction[key] || "").trim())
        || !destinationRegion
        || config.collectionObligationConfirmed !== true
        || registeredParts.length !== 2
        || registeredParts[0] !== countryCode
        || registeredRegion !== destinationRegion) {
        return fail("JURISDICTION_OR_NEXUS_REQUIRED", countryCode === "US"
          ? "Enter state, county and city, confirm the destination jurisdiction and your collection obligation, and save your registered jurisdiction."
          : "Enter the destination province, confirm your collection obligation and save your registered province.");
      }
      if (!allowedRegions.has(destinationRegion)) {
        return fail("INVALID_JURISDICTION", "Enter a valid US state or Canadian province/territory code.");
      }
    }
    const result = calculateManualTax({
      countryCode,
      currencyCode,
      currencyMinorUnits: MINOR_UNITS[currencyCode],
      amountMinor: amount,
      priceMode: config.priceMode,
      components: components.map((item) => ({
        id: String(item.id || ""),
        name: String(item.name || item.id || ""),
        rateBps: Number(item.rateBps),
      })),
      jurisdictionConfirmed: (countryCode === "US" || countryCode === "CA")
        ? config.collectionObligationConfirmed === true
        : true,
    });
    return result.ok
      ? { ...result, mode: "manual", countryCode, invoiceDate: issueDate, format, registrationEvidence: "user-attested", warning: result.warning + " Registration and collection obligations are not independently verified by Plivex." }
      : result;
  }

  if (mode !== "automatic") return fail("TAX_MODE_REQUIRED", "Choose automatic standard-rate calculation or enter manual rates.");
  if (countryCode === "US" || countryCode === "CA") {
    return fail("JURISDICTION_RULE_REQUIRED", "Automatic US/Canada rates are not enabled because a verified address-level jurisdiction provider is not configured. Enter reviewed rates manually or leave this invoice unfinalized.");
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
      jurisdictions: workspaceProfile?.registeredJurisdiction ? [workspaceProfile.registeredJurisdiction] : [],
    },
    placeOfSupplyVerified: true,
    placeOfSupply: String(config.placeOfSupply).trim(),
    taxCategoryVerified: true,
    taxCategory: String(config.taxCategory).trim(),
    treatment: "standard",
    priceMode: config.priceMode,
  });
  return result.ok
    ? { ...result, mode: "automatic", format, registrationEvidence: "user-attested", warning: "The standard-rate rule is source-backed. Seller registration, place of supply and tax category are self-declared and are not independently verified by Plivex." }
    : result;
}
