import { calculateVerifiedTaxRule } from "./verified-rule-evaluator.js";
import { getCountryStandardRateRule } from "./standard-rate-rules.js";

/**
 * Country router for the seven selectable Global workspaces.
 * India is intentionally delegated to the existing GST implementation.
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
    return { ok: false, status: "needs_review", code: "UNSUPPORTED_COUNTRY", message: "Country is not enabled in Plivex Global." };
  }
  const rule = input.rule || getCountryStandardRateRule(countryCode);
  if ((countryCode === "US" || countryCode === "CA") && !input.rule) {
    return { ok: false, status: "needs_review", code: "JURISDICTION_RULE_REQUIRED", message: "A verified US state/local or Canadian province tax rule is required; no national rate is assumed." };
  }
  return calculateVerifiedTaxRule({ ...input, countryCode, rule });
}
