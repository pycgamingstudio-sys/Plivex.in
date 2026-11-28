// Bundled copy for the save-invoice Edge Function. Keep in sync with ../tax/invoice-tax-integration.js
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
  // Convert each invoice line to integer minor units before applying discount.
  // This avoids accumulating floating-point currency fractions across items.
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  if (!items.length) return NaN;
  let subtotalMinor = 0;
  for (const item of items) {
    const quantity = Number(item?.quantity);
    const rate = Number(item?.rate);
    if (!Number.isFinite(quantity) || !Number.isFinite(rate) || quantity < 0 || rate < 0) return NaN;
    const lineMinor = Math.round(quantity * rate * 100);
    if (!Number.isSafeInteger(lineMinor) || !Number.isSafeInteger(subtotalMinor + lineMinor)) return NaN;
    subtotalMinor += lineMinor;
  }

  const rawDiscount = invoice?.discount === undefined || invoice?.discount === null || invoice.discount === ""
    ? 0 : Number(invoice.discount);
  if (!Number.isFinite(rawDiscount) || rawDiscount < 0) return NaN;
  if (invoice.discountType === "percent") {
    if (rawDiscount > 100) return NaN;
    const discountBps = Math.round(rawDiscount * 100);
    const product = subtotalMinor * discountBps;
    if (!Number.isSafeInteger(product)) return NaN;
    const discountMinor = Math.floor((product + 5000) / 10000);
    return Math.max(0, subtotalMinor - discountMinor);
  }
  const fixedDiscountMinor = Math.round(rawDiscount * 100);
  if (!Number.isSafeInteger(fixedDiscountMinor)) return NaN;
  return Math.max(0, subtotalMinor - Math.min(subtotalMinor, fixedDiscountMinor));
}


/** Allocate a single invoice discount across lines in minor units using the
 * largest-remainder method. This guarantees line allocations reconcile exactly. */
function allocateInvoiceDiscount(invoice) {
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  if (!items.length) return { ok: false, code: "INVALID_AMOUNT", message: "At least one invoice line is required." };
  const amounts = [];
  let subtotal = 0;
  for (const item of items) {
    const quantity = Number(item?.quantity), rate = Number(item?.rate);
    if (!Number.isFinite(quantity) || !Number.isFinite(rate) || quantity < 0 || rate < 0) {
      return { ok: false, code: "INVALID_AMOUNT", message: "Invoice line quantity and rate must be valid non-negative numbers." };
    }
    const amountMinor = Math.round(quantity * rate * 100);
    if (!Number.isSafeInteger(amountMinor) || !Number.isSafeInteger(subtotal + amountMinor)) {
      return { ok: false, code: "INVALID_AMOUNT", message: "Invoice amount exceeds safe calculation limits." };
    }
    amounts.push(amountMinor);
    subtotal += amountMinor;
  }
  const raw = invoice?.discount === undefined || invoice?.discount === null || invoice.discount === "" ? 0 : Number(invoice.discount);
  if (!Number.isFinite(raw) || raw < 0) return { ok: false, code: "INVALID_DISCOUNT", message: "Invoice discount must be a valid non-negative amount." };
  let discountMinor = 0;
  if (invoice.discountType === "percent") {
    if (raw > 100) return { ok: false, code: "INVALID_DISCOUNT", message: "Percentage discount cannot exceed 100%." };
    const bps = Math.round(raw * 100);
    discountMinor = Number((BigInt(subtotal) * BigInt(bps) + 5000n) / 10000n);
  } else {
    discountMinor = Math.min(subtotal, Math.round(raw * 100));
  }
  if (!Number.isSafeInteger(discountMinor)) return { ok: false, code: "INVALID_DISCOUNT", message: "Discount exceeds safe calculation limits." };
  if (subtotal === 0 || discountMinor === 0) return { ok: true, lines: amounts.map((amountMinor) => ({ amountMinor })) };
  const allocations = amounts.map((amount, index) => {
    const numerator = BigInt(discountMinor) * BigInt(amount);
    return { index, amount: Number(numerator / BigInt(subtotal)), remainder: numerator % BigInt(subtotal) };
  });
  let remaining = discountMinor - allocations.reduce((sum, item) => sum + item.amount, 0);
  allocations.sort((a, b) => a.remainder === b.remainder ? a.index - b.index : (a.remainder > b.remainder ? -1 : 1));
  for (let i = 0; i < remaining; i += 1) allocations[i].amount += 1;
  const discounts = new Array(amounts.length).fill(0);
  for (const allocation of allocations) discounts[allocation.index] = allocation.amount;
  return { ok: true, lines: amounts.map((amountMinor, index) => ({ amountMinor: amountMinor - discounts[index] })) };
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

  const config = {
    mode: ["US", "CA"].includes(countryCode) ? "manual" : "automatic",
    // A business that explicitly declares itself unregistered starts with the
    // commercial-invoice path. Issuance still requires a separate confirmation
    // that this transaction is not required to charge the country tax.
    taxMode: String(workspaceProfile?.registrationStatus || "unregistered").trim().toLowerCase() === "unregistered" ? "no_tax" : "taxable",
    noTaxConfirmed: false,
    priceMode: "exclusive",
    ...(invoice?.globalTax || {}),
  };
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
  if (!["standard", "reduced", "zero-rated", "gst-free", "exempt", "out-of-scope", "reverse-charge"].includes(selectedTreatment)) {
    return fail("UNSUPPORTED_TAX_TREATMENT", "This tax treatment is not supported. Keep the invoice as a draft.");
  }
  const normalizedTreatment = selectedTreatment === "standard" ? "standard-rated" : selectedTreatment;
  if (mode === "manual" && (normalizedTreatment !== "standard-rated" || !isSupportedManualTaxTreatment(config.taxCategory))) {
    return fail("UNSUPPORTED_TAX_TREATMENT", "Manual rates support standard-rated tax only. Special treatments require an exact verified country/category rule.");
  }
  if (![ "inclusive", "exclusive" ].includes(config.priceMode)) {
    return fail("PRICE_MODE_REQUIRED", "Choose whether each entered line price includes tax or excludes tax.");
  }
  if (mode !== "manual" && mode !== "automatic") {
    return fail("TAX_MODE_REQUIRED", "Choose automatic verified rules or explicitly entered manual rates.");
  }
  if (mode === "automatic" && countryCode === "CA") {
    const province = String(config.destinationJurisdiction?.province || "").trim().toUpperCase();
    if (!CA_JURISDICTIONS.has(province)) {
      return fail("DESTINATION_JURISDICTION_REQUIRED", "Select a valid Canadian province or territory for the place-of-supply rate.");
    }
    if (config.collectionObligationAttested !== true) {
      return fail("COLLECTION_OBLIGATION_ATTESTATION_REQUIRED", "Confirm that you have checked whether your business must collect GST/HST in the selected destination province.");
    }
  }
  if (mode === "automatic" && countryCode === "US") {
    return fail("JURISDICTION_RULE_REQUIRED", "US state, county, city and special-district tax requires an exact verified jurisdiction rule. No national rate is assumed.");
  }
  if (mode === "manual") {
    if (!Array.isArray(config.components) || config.components.length < 1 || config.components.length > 8) {
      return fail("MANUAL_COMPONENTS_REQUIRED", "Add one to eight manual tax components before calculating.");
    }
    const componentIds = new Set();
    for (const component of config.components) {
      const id = String(component?.id || "").trim();
      const rateBps = Number(component?.rateBps);
      if (!id || componentIds.has(id) || !Number.isInteger(rateBps) || rateBps <= 0 || rateBps > 10000) {
        return fail("MANUAL_COMPONENT_INVALID", "Each manual tax component needs a unique ID and a valid rate above 0% and no more than 100%.");
      }
      componentIds.add(id);
    }
    if (countryCode === "US" || countryCode === "CA") {
      const jurisdiction = config.destinationJurisdiction || {};
      const required = countryCode === "US" ? ["state", "county", "city"] : ["province"];
      const region = String(jurisdiction[countryCode === "US" ? "state" : "province"] || "").trim().toUpperCase();
      const registeredParts = String(workspaceProfile?.registeredJurisdiction || "").trim().toUpperCase().split("-");
      const sellerRegion = registeredParts[1] || "";
      const allowed = countryCode === "US" ? US_JURISDICTIONS : CA_JURISDICTIONS;
      if (required.some((key) => !String(jurisdiction[key] || "").trim()) || !region) {
        return fail("DESTINATION_JURISDICTION_REQUIRED", "Enter the required destination state/county/city or province/territory.");
      }
      if (!allowed.has(region) || registeredParts.length !== 2 || registeredParts[0] !== countryCode || !allowed.has(sellerRegion)) {
        return fail("INVALID_JURISDICTION", "Enter valid destination and seller registration state/province codes for the selected country.");
      }
      if (config.collectionObligationAttested !== true) {
        return fail("COLLECTION_OBLIGATION_ATTESTATION_REQUIRED", "Confirm that you have checked the collection obligation for this destination.");
      }
    }
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

  const lineAmounts = allocateInvoiceDiscount(invoice);
  if (!lineAmounts.ok) return fail(lineAmounts.code, lineAmounts.message);
  const lineResults = [];
  for (let index = 0; index < lineAmounts.lines.length; index += 1) {
    const line = lineAmounts.lines[index];
    const item = invoice.items[index] || {};
    const hasLineOverride = item.taxTreatment !== undefined || item.taxCategory !== undefined;
    if (hasLineOverride && (item.taxTreatmentConfirmed !== true || item.taxCategoryConfirmed !== true)) {
      return fail("LINE_TAX_CONFIRMATION_REQUIRED", "Confirm the tax treatment and goods/services category for invoice line " + (index + 1) + ".");
    }
    const lineTreatmentRaw = String(item.taxTreatment || selectedTreatment).trim().toLowerCase();
    const lineTreatment = lineTreatmentRaw === "standard-rated" ? "standard" : lineTreatmentRaw;
    if (!["standard", "reduced", "zero-rated", "gst-free", "exempt", "out-of-scope", "reverse-charge"].includes(lineTreatment)) {
      return fail("UNSUPPORTED_LINE_TREATMENT", "Invoice line " + (index + 1) + " has an unsupported tax treatment.");
    }
    const lineCategory = String(item.taxCategory || config.taxCategory || "").trim();
    let calculated;
    if (mode === "manual") {
      const draftSpecialTreatment = config.resolvedRuleSource === "supabase" && config.ruleMode === "draft_test"
        && ["reduced", "zero-rated", "gst-free", "exempt", "out-of-scope"].includes(lineTreatment);
      if (lineTreatment !== "standard" && !draftSpecialTreatment) {
        return fail("MANUAL_SPECIAL_TREATMENT_UNSUPPORTED", "This tax treatment requires an exact supported country/category rule. Keep the invoice in review.");
      }
      calculated = calculateManualTax({
        countryCode, currencyCode, currencyMinorUnits: MINOR_UNITS[currencyCode],
        amountMinor: line.amountMinor, priceMode: config.priceMode, taxTreatment: "standard-rated",
        components: config.components.map((component) => ({
          id: String(component.id || ""), name: String(component.name || component.id || ""),
          rateBps: Number(component.rateBps),
        })),
        jurisdictionConfirmed: (countryCode === "US" || countryCode === "CA")
          ? config.collectionObligationAttested === true : true,
      });
      if (calculated.ok && draftSpecialTreatment) {
        calculated = {
          ...calculated, treatment:lineTreatment,
          taxDisclosure:lineTreatment === "zero-rated" ? "Zero-rated supply under the selected draft baseline rule."
            : lineTreatment === "gst-free" ? "GST-free supply under the selected draft baseline rule."
            : lineTreatment === "exempt" ? "Exempt supply under the selected draft baseline rule."
            : lineTreatment === "out-of-scope" ? "Out-of-scope supply under the selected draft baseline rule."
            : "Reduced-rate supply under the selected draft baseline rule.",
        };
      }
    } else {
      calculated = calculateGlobalTax({
        countryCode, currencyCode, currencyMinorUnits: MINOR_UNITS[currencyCode],
        amountMinor: line.amountMinor, invoiceDate: issueDate,
        sellerRegistration: {
          verified: false, attestedByUser: true, status: registrationStatus,
          registrationNumber, effectiveFrom: registrationEffectiveFrom,
        },
        placeOfSupplyVerified: true, placeOfSupply: String(config.placeOfSupply).trim(),
        taxCategoryVerified: true, taxCategory: lineCategory,
        treatment: lineTreatment,
        ...(config.resolvedRuleSource === "supabase" && config.ruleMode === "verified" && config.resolvedRule
          ? { rule: config.resolvedRule } : {}),
        ...(lineTreatment === "reverse-charge" ? { reverseChargeEvidence: config.reverseChargeEvidence || {} } : {}),
        ...(countryCode === "CA" ? {
          jurisdictionId: String(config.destinationJurisdiction.province).trim().toUpperCase(),
          jurisdictionAttestedByUser: true,
          collectionObligationAttestedByUser: config.collectionObligationAttested === true,
        } : {}),
        priceMode: config.priceMode,
      });
    }
    if (!calculated.ok) return fail(calculated.code || "LINE_TAX_REVIEW_REQUIRED",
      "Invoice line " + (index + 1) + ": " + (calculated.message || "A verified tax rule is unavailable."));
    lineResults.push({
      lineIndex: index, lineId: item.id || null,
      description: String(item.description || "").slice(0, 500),
      amountMinor: line.amountMinor, taxableMinor: calculated.taxableMinor,
      taxMinor: calculated.taxMinor, totalMinor: calculated.totalMinor,
      recipientTaxMinor: calculated.recipientTaxMinor || 0,
      recipientTaxComponents: calculated.recipientTaxComponents || [],
      recipientAccountingRequired: calculated.recipientAccountingRequired === true,
      jurisdictionEvidence: calculated.jurisdictionEvidence || null,
      collectionObligationEvidence: calculated.collectionObligationEvidence || null,
      taxDisclosure: calculated.taxDisclosure || null,
      treatment: calculated.treatment || lineTreatment,
      taxCategory: lineCategory,
      ruleSnapshot: calculated.ruleSnapshot || null,
      components: calculated.components.map((component) => ({ ...component })),
      calculationStatus: calculated.status,
    });
  }

  const taxableMinor = lineResults.reduce((sum, line) => sum + line.taxableMinor, 0);
  const taxMinor = lineResults.reduce((sum, line) => sum + line.taxMinor, 0);
  const recipientTaxMinor = lineResults.reduce((sum, line) => sum + line.recipientTaxMinor, 0);
  const totalMinor = lineResults.reduce((sum, line) => sum + line.totalMinor, 0);
  if (![taxableMinor, taxMinor, totalMinor].every(Number.isSafeInteger)
    || totalMinor !== taxableMinor + taxMinor) {
    return fail("INVOICE_TOTAL_OUT_OF_RANGE", "Combined invoice tax totals exceed safe calculation limits.");
  }
  const componentMap = new Map();
  for (const line of lineResults) for (const component of line.components) {
    const key = [component.id, component.name, component.rateBps, component.source || ""].join("|");
    const existing = componentMap.get(key) || { ...component, amountMinor: 0 };
    existing.amountMinor += component.amountMinor;
    componentMap.set(key, existing);
  }
  const components = [...componentMap.values()];
  if (components.reduce((sum, component) => sum + component.amountMinor, 0) !== taxMinor) {
    return fail("LINE_TAX_COMPONENT_MISMATCH", "Per-line tax components do not reconcile to the invoice tax total.");
  }
  const recipientTaxMap = new Map();
  for (const line of lineResults) for (const component of line.recipientTaxComponents) {
    const key = [component.id, component.name, component.rateBps, component.source || ""].join("|");
    const existing = recipientTaxMap.get(key) || { ...component, amountMinor: 0 };
    existing.amountMinor += component.amountMinor;
    recipientTaxMap.set(key, existing);
  }
  const recipientTaxComponents = [...recipientTaxMap.values()];
  if (recipientTaxComponents.reduce((sum, component) => sum + component.amountMinor, 0) !== recipientTaxMinor) {
    return fail("RECIPIENT_TAX_COMPONENT_MISMATCH", "Recipient reverse-charge components do not reconcile to the recipient tax amount.");
  }
  const manual = lineResults.some((line) => line.calculationStatus === "manual_unverified");
  const commonRule = lineResults.every((line) => JSON.stringify(line.ruleSnapshot) === JSON.stringify(lineResults[0].ruleSnapshot))
    ? lineResults[0].ruleSnapshot : null;
  const commonTreatment = lineResults.every((line) => line.treatment === lineResults[0].treatment)
    ? lineResults[0].treatment : "mixed";
  const commonCategory = lineResults.every((line) => line.taxCategory === lineResults[0].taxCategory)
    ? lineResults[0].taxCategory : "mixed";
  const result = {
    ok: true, status: manual ? "manual_unverified" : "calculated",
    engineVersion: "1.0.0", countryCode, currencyCode,
    currencyMinorUnits: MINOR_UNITS[currencyCode], priceMode: config.priceMode,
    treatment: commonTreatment, taxCategory: commonCategory,
    taxableMinor, taxMinor, totalMinor, components,
    recipientTaxMinor, recipientTaxComponents,
    recipientAccountingRequired: recipientTaxMinor > 0,
    jurisdictionEvidence: lineResults.every((line) => line.jurisdictionEvidence === lineResults[0].jurisdictionEvidence)
      ? lineResults[0].jurisdictionEvidence : null,
    collectionObligationEvidence: lineResults.every((line) => line.collectionObligationEvidence === lineResults[0].collectionObligationEvidence)
      ? lineResults[0].collectionObligationEvidence : null,
    lineTaxBreakdown: lineResults,
    ruleSnapshot: commonRule ? { ...commonRule, treatment: commonTreatment } : null,
    taxCharged: lineResults.some((line) => line.taxMinor > 0),
    taxDisclosure: commonTreatment === "mixed" ? "Mixed tax treatments are recorded per invoice line."
      : (lineResults.every((line) => line.taxDisclosure === lineResults[0].taxDisclosure) ? lineResults[0].taxDisclosure : undefined),
    registrationEvidence: "user-attested", format,
    warning: manual
      ? "One or more line rates were entered manually and are not independently verified. Confirm treatment and collection obligations with an appropriate tax professional or official source."
      : "Tax was calculated separately for each invoice line after allocating the invoice discount. Seller registration, place of supply and supply categories are user-confirmed and are not independently verified by Plivex.",
    eInvoiceReadiness: getEInvoiceReadiness(countryCode),
    taxSnapshot: null,
  };
  if (!manual && lineResults.every((line) => line.ruleSnapshot)) {
    const finalized = createGlobalInvoiceTaxSnapshot({ countryCode, invoiceDate: issueDate, taxResult: result });
    if (finalized.ok) result.taxSnapshot = finalized.snapshot;
  }
  return result;
}
