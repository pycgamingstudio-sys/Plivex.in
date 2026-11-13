/**
 * Country identity registry for the isolated Global edition.
 *
 * "identity-only" means the country can be selected as a business location.
 * It does NOT mean tax, invoicing, payments, or legal compliance are implemented.
 * Currency and locale are separate fields and must never be inferred from one another.
 */

const entries = [
  { code: "IN", name: "India", currencyCode: "INR", locales: ["en-IN", "hi-IN"] },
  { code: "US", name: "United States", currencyCode: "USD", locales: ["en-US", "es-US"] },
  { code: "GB", name: "United Kingdom", currencyCode: "GBP", locales: ["en-GB"] },
  { code: "AE", name: "United Arab Emirates", currencyCode: "AED", locales: ["en-AE", "ar-AE"] },
  { code: "CA", name: "Canada", currencyCode: "CAD", locales: ["en-CA", "fr-CA"] },
  { code: "AU", name: "Australia", currencyCode: "AUD", locales: ["en-AU"] },
  { code: "SG", name: "Singapore", currencyCode: "SGD", locales: ["en-SG", "zh-SG", "ms-SG", "ta-SG"] },
];

export const COUNTRY_REGISTRY = Object.freeze(
  entries.map((entry) => Object.freeze({
    ...entry,
    locales: Object.freeze([...entry.locales]),
    capability: "identity-only",
  })),
);

const countriesByCode = new Map(COUNTRY_REGISTRY.map((country) => [country.code, country]));

/** Returns a country only for a valid ISO 3166-1 alpha-2 code. */
export function getCountryByCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? countriesByCode.get(code) ?? null : null;
}

/** Returns a copy so callers cannot mutate the canonical registry. */
export function listSelectableCountries() {
  return COUNTRY_REGISTRY.map((country) => ({
    ...country,
    locales: [...country.locales],
  }));
}
