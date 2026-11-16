/**
 * Resolver for externally maintained, versioned tax-rule snapshots.
 * It deliberately does not invent rates or decide registration/nexus.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_CURRENCY = Object.freeze({ IN: "INR", US: "USD", GB: "GBP", AE: "AED", CA: "CAD", AU: "AUD", SG: "SGD" });
const OFFICIAL_HOSTS = Object.freeze({
  IN: ["cbic-gst.gov.in", "gst.gov.in"], US: ["gov"], GB: ["gov.uk"],
  AE: ["tax.gov.ae", "mof.gov.ae"], CA: ["canada.ca", "revenuquebec.ca", "gouv.qc.ca"],
  AU: ["ato.gov.au"], SG: ["iras.gov.sg"],
});
const isValidDate = (value) => {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function officialSource(country, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    return (OFFICIAL_HOSTS[country] || []).some((host) =>
      url.hostname === host || url.hostname.endsWith("." + host));
  } catch { return false; }
}
export function validateTaxRuleSnapshot(rule) {
  if (!isRecord(rule)) return { ok: false, code: "INVALID_RULE" };
  if (typeof rule.id !== "string" || !rule.id.trim() || typeof rule.version !== "string" || !rule.version.trim()) return { ok: false, code: "RULE_ID_VERSION_REQUIRED" };
  if (!/^[A-Z]{2}$/.test(rule.countryCode || "") || !/^[A-Z]{3}$/.test(rule.currencyCode || "")
    || !Object.hasOwn(COUNTRY_CURRENCY, rule.countryCode) || COUNTRY_CURRENCY[rule.countryCode] !== rule.currencyCode) return { ok: false, code: "INVALID_COUNTRY_CURRENCY" };
  if (!["standard", "reduced", "zero-rated", "exempt", "reverse-charge", "out-of-scope"].includes(rule.treatment)) return { ok: false, code: "INVALID_TREATMENT" };
  if (!isValidDate(rule.effectiveFrom) || (rule.effectiveTo !== null && rule.effectiveTo !== undefined
    && (!isValidDate(rule.effectiveTo) || rule.effectiveTo < rule.effectiveFrom))) return { ok: false, code: "INVALID_EFFECTIVE_DATES" };
  if (!isValidDate(rule.reviewedOn) || !officialSource(rule.countryCode, rule.source)
    || typeof rule.reviewedBy !== "string" || !rule.reviewedBy.trim()) return { ok: false, code: "SOURCE_OR_REVIEW_REQUIRED" };
  if ((rule.countryCode === "US" || rule.countryCode === "CA")
    && (typeof rule.jurisdictionId !== "string" || !rule.jurisdictionId.trim())) return { ok: false, code: "JURISDICTION_REQUIRED" };
  if (rule.verified !== true || !Array.isArray(rule.components) || rule.components.length < 1 || rule.components.length > 8) return { ok: false, code: "UNVERIFIED_RULE" };
  const ids = new Set();
  let combinedRate = 0;
  for (const component of rule.components) {
    if (!isRecord(component) || typeof component.id !== "string" || !component.id.trim() || ids.has(component.id)
      || !Number.isInteger(component.rateBps) || component.rateBps < 0 || component.rateBps > 10000
      || (component.source && !officialSource(rule.countryCode, component.source))) return { ok: false, code: "INVALID_COMPONENT" };
    ids.add(component.id);
    combinedRate += component.rateBps;
  }
  if (combinedRate > 10000) return { ok: false, code: "COMBINED_RATE_EXCEEDS_LIMIT" };
  return { ok: true, rule: Object.freeze({ ...rule, components: Object.freeze(rule.components.map((c) => Object.freeze({ ...c }))) }) };
}
export function resolveTaxRuleSnapshot(rules, { countryCode, jurisdictionId = null, invoiceDate, treatment }) {
  if (!Array.isArray(rules) || !isValidDate(invoiceDate)) return { ok: false, code: "INVALID_RESOLUTION_INPUT" };
  const country = String(countryCode || "").toUpperCase();
  if (!Object.hasOwn(COUNTRY_CURRENCY, country)) return { ok: false, code: "UNSUPPORTED_COUNTRY" };
  if ((country === "US" || country === "CA") && (typeof jurisdictionId !== "string" || !jurisdictionId.trim())) {
    return { ok: false, code: "JURISDICTION_REQUIRED" };
  }
  const candidates = [];
  for (const raw of rules) {
    const checked = validateTaxRuleSnapshot(raw);
    if (!checked.ok) continue;
    const rule = checked.rule;
    if (rule.countryCode !== country || rule.treatment !== treatment
      || (rule.jurisdictionId || null) !== (jurisdictionId || null)) continue;
    if (invoiceDate < rule.effectiveFrom || (rule.effectiveTo && invoiceDate > rule.effectiveTo)) continue;
    candidates.push(rule);
  }
  if (candidates.length === 0) return { ok: false, code: "NO_EFFECTIVE_VERIFIED_RULE" };
  if (candidates.length !== 1) return { ok: false, code: "AMBIGUOUS_EFFECTIVE_RULE" };
  return { ok: true, rule: candidates[0] };
}
