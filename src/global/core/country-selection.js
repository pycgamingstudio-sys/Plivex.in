import { getCountryByCode } from "../countries/country-registry.js";

export const COUNTRY_SELECTION_STORAGE_KEY = "plivex.global.country-selection";
export const COUNTRY_SELECTION_SCHEMA_VERSION = 1;

/**
 * Validates an explicit country choice. No implicit country detection or fallback.
 */
export function validateCountrySelection(countryCode) {
  const country = getCountryByCode(countryCode);
  if (!country) {
    return { valid: false, country: null, error: "UNSUPPORTED_COUNTRY" };
  }
  return { valid: true, country, error: null };
}

/**
 * Creates a storage-backed selection store.
 *
 * Storage is injected to keep this module SSR-safe and testable. The caller must
 * explicitly confirm a choice before it can be saved. Invalid or stale stored
 * values are ignored rather than silently converted to another country.
 */
export function createCountrySelectionStore(storage) {
  const canUseStorage = storage
    && typeof storage.getItem === "function"
    && typeof storage.setItem === "function"
    && typeof storage.removeItem === "function";

  function read() {
    if (!canUseStorage) return null;

    try {
      const raw = storage.getItem(COUNTRY_SELECTION_STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (
        !parsed
        || parsed.schemaVersion !== COUNTRY_SELECTION_SCHEMA_VERSION
        || typeof parsed.countryCode !== "string"
      ) return null;

      const result = validateCountrySelection(parsed.countryCode);
      return result.valid ? result.country : null;
    } catch {
      return null;
    }
  }

  function save({ countryCode, confirmed } = {}) {
    if (confirmed !== true) {
      return { saved: false, error: "EXPLICIT_CONFIRMATION_REQUIRED" };
    }

    const result = validateCountrySelection(countryCode);
    if (!result.valid) {
      return { saved: false, error: result.error };
    }
    if (!canUseStorage) {
      return { saved: false, error: "STORAGE_UNAVAILABLE" };
    }

    try {
      storage.setItem(COUNTRY_SELECTION_STORAGE_KEY, JSON.stringify({
        schemaVersion: COUNTRY_SELECTION_SCHEMA_VERSION,
        countryCode: result.country.code,
      }));
      return { saved: true, country: result.country, error: null };
    } catch {
      return { saved: false, error: "STORAGE_WRITE_FAILED" };
    }
  }

  function clear() {
    if (!canUseStorage) return false;
    try {
      storage.removeItem(COUNTRY_SELECTION_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  return Object.freeze({ read, save, clear });
}

/** Browser convenience factory; safe during SSR and in restricted browsers. */
export function createBrowserCountrySelectionStore() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return createCountrySelectionStore(null);
    }
    return createCountrySelectionStore(window.localStorage);
  } catch {
    return createCountrySelectionStore(null);
  }
}
