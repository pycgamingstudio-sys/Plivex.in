/**
 * Stable edition identifiers for future multi-edition work.
 *
 * Runtime routing is opt-in: legacy edition builds remain unchanged, while a
 * unified build mounts Global only below the /global path.
 */

export const EDITION_IDS = Object.freeze({
  INDIA: "india",
  GLOBAL: "global",
});

export const DEFAULT_EDITION_ID = EDITION_IDS.INDIA;

export const UNIFIED_EDITION_ID = "unified";

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

/** Resolve the edition for a unified same-origin build without changing legacy builds. */
export function resolveRuntimeEdition(buildEdition, pathname = "/") {
  if (buildEdition === UNIFIED_EDITION_ID) {
    return typeof pathname === "string" && /^\\/global(?:\\/|$)/.test(pathname)
      ? EDITION_IDS.GLOBAL
      : EDITION_IDS.INDIA;
  }
  return resolveEditionId(buildEdition);
}

/** True only when the input is an exact, supported edition identifier. */
export function isSupportedEditionId(value) {
  return typeof value === "string" && ALLOWED_EDITION_IDS.has(value);
}
