import { calculateVerifiedTaxRule } from "./verified-rule-evaluator.js";

const TREATMENTS = Object.freeze(["standard", "reduced", "zero-rated", "gst-free", "exempt", "out-of-scope"]);
const NO_CHARGE_TREATMENTS = new Set(["zero-rated", "gst-free", "exempt", "out-of-scope"]);
const DISCLOSURES = Object.freeze({
  standard: "Tax charged at the verified standard rate.",
  reduced: "Tax charged at the verified reduced rate for the confirmed supply category.",
  "zero-rated": "Zero-rated supply — 0% tax under the selected verified rule. This is not the same as exempt.",
  "gst-free": "GST-free supply — no GST charged under the selected verified Australian GST-free category. This is distinct from input-taxed supplies.",
  exempt: "Exempt supply — no tax charged under the selected verified rule.",
  "out-of-scope": "Outside the scope of this tax system under the selected verified rule.",
});

/**
 * Evaluates a source-backed, versioned treatment rule using the shared
 * integer-only arithmetic engine. This module does not decide whether a
 * product/service qualifies for a treatment; that classification must be
 * explicitly confirmed and represented by the selected rule snapshot.
 *
 * Reverse charge is intentionally excluded: seller/buyer accounting and
 * disclosure differ by jurisdiction and need a dedicated adapter.
 */
export function calculateVerifiedTaxTreatment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: "needs_review", code: "INVALID_INPUT", message: "Tax calculation input is required." };
  }
  const treatment = typeof input.treatment === "string" ? input.treatment.trim().toLowerCase() : "";
  if (!TREATMENTS.includes(treatment)) {
    return {
      ok: false, status: "needs_review", code: "TREATMENT_ADAPTER_REQUIRED",
      message: "This tax treatment is not supported by the current verified calculation adapter. Keep the invoice as a draft.",
    };
  }
  const rule = input.rule;
  if (!rule || typeof rule !== "object" || Array.isArray(rule) || rule.treatment !== treatment) {
    return {
      ok: false, status: "needs_review", code: "TREATMENT_RULE_MISMATCH",
      message: "A verified rule matching the selected tax treatment is required.",
    };
  }
  if (treatment !== "standard" && (!String(rule.taxCategoryId || "").trim()
    || String(input.taxCategory || "").trim() !== rule.taxCategoryId)) {
    return {
      ok: false, status: "needs_review", code: "TREATMENT_CATEGORY_RULE_REQUIRED",
      message: "Reduced, zero-rated, exempt and out-of-scope rules must match an explicitly confirmed product/service tax category.",
    };
  }
  if (!Array.isArray(rule.components) || rule.components.length < 1
    || rule.components.some((component) => !component || !Number.isFinite(component.rateBps) || !Number.isInteger(component.rateBps * 10) || component.rateBps < 0)) {
    return { ok: false, status: "needs_review", code: "INVALID_TAX_COMPONENTS", message: "Verified tax components are required." };
  }
  const combinedRate = rule.components.reduce((sum, component) => sum + component.rateBps, 0);
  if (combinedRate > 10000 || (NO_CHARGE_TREATMENTS.has(treatment) && combinedRate !== 0)
    || (!NO_CHARGE_TREATMENTS.has(treatment) && combinedRate === 0)) {
    return {
      ok: false, status: "needs_review", code: "TREATMENT_RATE_MISMATCH",
      message: "The verified component rates do not match the selected tax treatment.",
    };
  }

  // The underlying evaluator performs all provenance, registration, date,
  // jurisdiction, amount and rounding checks. Its arithmetic is treatment
  // agnostic, so normalize only the internal arithmetic label after validating
  // the original treatment and rate semantics above.
  const calculated = calculateVerifiedTaxRule({
    ...input,
    treatment: "standard",
    rule: { ...rule, treatment: "standard" },
  });
  if (!calculated.ok) return calculated;

  return {
    ...calculated,
    treatment,
    taxCategory: input.taxCategory || rule.taxCategoryId || null,
    taxDisclosure: DISCLOSURES[treatment],
    taxCharged: !NO_CHARGE_TREATMENTS.has(treatment),
    ruleSnapshot: {
      ...calculated.ruleSnapshot,
      treatment,
      taxCategoryId: rule.taxCategoryId || null,
    },
  };
}
