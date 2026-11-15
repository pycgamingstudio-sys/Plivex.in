/**
 * Stable edition identifiers for future multi-edition work.
 *
 * This module is intentionally not imported by the India application yet.
 * Global behavior must remain opt-in until a reviewed integration release.
 */

export const EDITION_IDS = Object.freeze({
  INDIA: "india",
  GLOBAL: "global",
});

export const DEFAULT_EDITION_ID = EDITION_IDS.INDIA;

export const UNIFIED_EDITION_ID = "unified";

// A workspace country, not a URL path or separate deployment, selects regional behavior.
const INDIA_COUNTRY_CODE = "IN";
const ISO_COUNTRY_CODE = /^[A-Z]{2}$/;

const ALLOWED_EDITION_IDS = new Set(Object.values(EDITION_IDS));

/**
 * Resolve an explicit edition identifier safely.
 *
 * Missing, non-string, whitespace-padded, or unknown values resolve to India.
 * This is a fail-closed compatibility default, not a country-detection system.
 */
export function resolveEditionId(value) {
  if (typeof value !== "string") return DEFAULT_EDITION_ID;

  const normalized = value.trim().toLowerCase();
  return ALLOWED_EDITION_IDS.has(normalized)
    ? normalized
    : DEFAULT_EDITION_ID;
}

/**
 * Resolve the regional rules for a workspace inside the single Plivex application.
 * India retains the existing India behavior; supported non-India countries use
 * Global behavior. Unknown or malformed countries return null so callers must
 * request a valid country instead of silently assigning the wrong tax regime.
 */
export function resolveWorkspaceEdition(countryCode, supportedCountryCodes = []) {
  if (typeof countryCode !== "string") return null;
  const normalized = countryCode.trim().toUpperCase();
  if (!ISO_COUNTRY_CODE.test(normalized)) return null;
  if (normalized === INDIA_COUNTRY_CODE) return EDITION_IDS.INDIA;
  const supported = new Set(supportedCountryCodes.map((code) => String(code).trim().toUpperCase()));
  return supported.has(normalized) ? EDITION_IDS.GLOBAL : null;
}

/** True only when the input is an exact, supported edition identifier. */
export function isSupportedEditionId(value) {
  return typeof value === "string" && ALLOWED_EDITION_IDS.has(value);
}
