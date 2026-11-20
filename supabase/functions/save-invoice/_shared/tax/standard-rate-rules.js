// Bundled copy for the save-invoice Edge Function. Keep in sync with src/global/tax/standard-rate-rules.js.
/**
 * Compatibility adapter over the versioned tax rule catalogue.
 * Keep the existing evaluator contract stable while the catalogue evolves.
 */
import { getTaxRuleSet } from "./tax-rule-registry.js";

export function getCountryStandardRateRule(countryCode, options = {}) {
  const result = getTaxRuleSet(countryCode, options);
  if (!result.ok) return null;
  const rule = result.rule;
  return {
    ...rule,
    verified: true,
    reviewedBy: rule.reviewedBy || "Plivex tax review",
    catalogVersion: result.catalogVersion,
    components: rule.components.map((component) => ({ ...component })),
  };
}
