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

/** True only when the input is an exact, supported edition identifier. */
export function isSupportedEditionId(value) {
  return typeof value === "string" && ALLOWED_EDITION_IDS.has(value);
}
