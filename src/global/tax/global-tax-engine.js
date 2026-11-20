import { calculateVerifiedTaxTreatment } from "./tax-treatment-evaluator.js";
import { getCountryStandardRateRule } from "./standard-rate-rules.js";
import { getTaxTreatmentRuleSet } from "./tax-rule-registry.js";
import { resolveTaxRuleSnapshot } from "./tax-rule-registry.js";

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
  if (!rule && treatment === "standard") rule = getCountryStandardRateRule(countryCode);
  if (!rule && treatment !== "standard") {
    const resolvedTreatment = getTaxTreatmentRuleSet(countryCode, {
      treatment,
      taxCategoryId: input.taxCategory,
      asOfDate: input.invoiceDate,
    });
    if (!resolvedTreatment.ok) {
      return { ok: false, status: "needs_review", code: resolvedTreatment.code, message: "No verified rule exists for this exact tax treatment and confirmed supply category." };
    }
    rule = {
      ...resolvedTreatment.rule,
      catalogVersion: resolvedTreatment.catalogVersion,
    };
  }
  if ((countryCode === "US" || countryCode === "CA") && !input.rule) {
    return { ok: false, status: "needs_review", code: "JURISDICTION_RULE_REQUIRED", message: "A verified US state/local or Canadian province tax rule is required; no national rate is assumed." };
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
