// Draft tax baselines are opt-in for test environments only. Missing configuration fails closed.
export const isDraftTaxRulesAllowed = (value) => value === "true";
