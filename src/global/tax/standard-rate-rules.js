/**
 * Compatibility adapter over the versioned tax rule catalogue.
 * Keep the existing evaluator contract stable while the catalogue evolves.
 */
import { getTaxRuleSet } from "./tax-rule-registry.js";

export function getCountryStandardRateRule(countryCode) {
  const result = getTaxRuleSet(countryCode);
  if (!result.ok) return null;
  const rule = result.rule;
  return {
    ...rule,
    verified: true,
    components: rule.components.map((component) => ({ ...component })),
  };
}
