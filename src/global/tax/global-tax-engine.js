import { calculateVerifiedTaxTreatment } from "./tax-treatment-evaluator.js";
import { getCountryStandardRateRule } from "./standard-rate-rules.js";
import { getTaxTreatmentRuleSet } from "./tax-rule-registry.js";
import { resolveTaxRuleSnapshot, resolveSupabaseTaxRuleAsync } from "./tax-rule-registry.js";
import { calculateManualTax } from "./manual-tax-calculator.js";

/**
 * Country router for the seven selectable Main Workspace countries.
 * India is intentionally delegated to the established GST implementation.
 * US/Canada require a verified jurisdiction-specific rule snapshot.
 */
export function calculateGlobalTax(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: "needs_review", code: "INVALID_INPUT", message: "Tax calculation input is required." };
  }
  const countryCode = String(input.countryCode || "").trim().toUpperCase();
  if (countryCode === "IN") {
    return { ok: false, status: "needs_review", code: "INDIA_LEGACY_ADAPTER_REQUIRED", message: "Use the existing India GST invoice calculation and reporting path." };
  }
  if (!["US", "GB", "AE", "CA", "AU", "SG"].includes(countryCode)) {
    return { ok: false, status: "needs_review", code: "UNSUPPORTED_COUNTRY", message: "Country is not enabled in Plivex Main Workspace." };
  }
  const treatment = input.treatment || "standard";
  let rule = input.rule || null;
  if (!rule && treatment === "standard") rule = getCountryStandardRateRule(countryCode, { jurisdictionId: input.jurisdictionId, asOfDate: input.invoiceDate });
  if (!rule && treatment !== "standard") {
    const resolvedTreatment = getTaxTreatmentRuleSet(countryCode, {
      treatment,
      taxCategoryId: input.taxCategory,
      asOfDate: input.invoiceDate,
      jurisdictionId: input.jurisdictionId,
    });
    if (!resolvedTreatment.ok) {
      return { ok: false, status: "needs_review", code: resolvedTreatment.code, message: "No verified rule exists for this exact tax treatment and confirmed supply category." };
    }
    rule = {
      ...resolvedTreatment.rule,
      catalogVersion: resolvedTreatment.catalogVersion,
    };
  }
  if (countryCode === "US" && !rule) {
    return { ok: false, status: "needs_review", code: "JURISDICTION_RULE_REQUIRED", message: "A verified US state/local tax rule is required; no national rate is assumed." };
  }
  if (countryCode === "CA" && !rule) {
    return { ok: false, status: "needs_review", code: "CANADIAN_PROVINCE_REQUIRED", message: "Select an exact Canadian province or territory to resolve the GST/HST rate." };
  }
  return calculateVerifiedTaxTreatment({ ...input, countryCode, rule });
}

/**
 * Resolve a maintained, verified rule for the exact jurisdiction, treatment
 * and invoice date before calculating. No default or nearest-jurisdiction
 * fallback exists.
 */
export function calculateGlobalTaxWithRegistry(input, rules) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: "needs_review", code: "INVALID_INPUT", message: "Tax calculation input is required." };
  }
  const countryCode = String(input.countryCode || "").trim().toUpperCase();
  if (countryCode === "IN") {
    return { ok: false, status: "needs_review", code: "INDIA_LEGACY_ADAPTER_REQUIRED", message: "Use the existing India GST invoice calculation and reporting path." };
  }
  const resolved = resolveTaxRuleSnapshot(rules, {
    countryCode,
    jurisdictionId: input.jurisdictionId || null,
    invoiceDate: input.invoiceDate,
    treatment: input.treatment,
  });
  if (!resolved.ok) {
    return { ok: false, status: "needs_review", code: resolved.code, message: "No unique verified tax rule is effective for this invoice and jurisdiction." };
  }
  return calculateGlobalTax({ ...input, countryCode, rule: resolved.rule });
}


/**
 * Async workspace-country tax entry point. Database access is supplied by the
 * trusted caller; browser clients must never use a service-role credential.
 * Draft rows can be used only with explicit allowDraft=true and are labelled
 * draft_test so they cannot be mistaken for verified tax results.
 */
export async function calculateGlobalTaxAsync(input, supabase, { allowDraft = false } = {}) {
  if (!input || typeof input !== "object" || !supabase) {
    return { ok:false, status:"needs_review", code:"INVALID_INPUT", message:"Tax input and a database resolver are required." };
  }
  const countryCode = String(input.countryCode || "").trim().toUpperCase();
  if (countryCode === "IN") {
    return { ok:false, status:"india_legacy", code:"INDIA_GST_SPLIT_REQUIRED", message:"India must resolve GST slab and same-state CGST+SGST versus inter-state IGST in the India GST adapter." };
  }
  const resolved = await resolveSupabaseTaxRuleAsync(supabase, {
    countryCode, jurisdictionId:input.jurisdictionId || null,
    invoiceDate:input.invoiceDate, treatment:input.treatment || "standard",
    taxCode:input.taxCode || null, allowDraft,
  });
  if (!resolved.ok) {
    return { ok:false, status:"needs_review", code:resolved.code, message:"No effective tax rule was found for this Workspace country and jurisdiction." };
  }
  if (resolved.mode === "draft_test") {
    const calculated = calculateManualTax({
      countryCode, currencyCode:input.currencyCode, currencyMinorUnits:input.currencyMinorUnits,
      amountMinor:input.amountMinor, priceMode:input.priceMode,
      taxTreatment:"standard-rated",
      components:resolved.rule.components.map((component)=>({
        id:component.id,name:component.name,rateBps:component.rateBps,
      })),
      jurisdictionConfirmed:input.collectionObligationAttestedByUser === true,
    });
    return calculated.ok ? {
      ...calculated, status:"draft_test", ruleSnapshot:{
        id:resolved.rule.id,version:resolved.rule.version,countryCode,
        jurisdictionId:resolved.rule.jurisdictionId,effectiveFrom:resolved.rule.effectiveFrom,
        source:resolved.rule.source,status:"draft",ruleMode:"draft_test",
      },
      warning:"Draft baseline rule for testing only; not legally verified.",
    } : calculated;
  }
  return calculateGlobalTax({ ...input, countryCode, rule:{ ...resolved.rule, verified:true } });
}
