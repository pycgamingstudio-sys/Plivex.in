/**
 * Country and phone identity registry for the unified Plivex application.
 *
 * "identity-only" describes country selection and locale metadata, not tax jurisdiction.
 * Billing prices and provider currency availability are configured separately.
 * It does NOT imply tax calculation, legal invoice compliance, or FX conversion.
 * Currency and locale are separate fields and must never be inferred from one another.
 */

const entries = [
  { code: "IN", name: "India", currencyCode: "INR", phoneCode: "+91", locales: ["en-IN", "hi-IN"] },
  { code: "US", name: "United States", currencyCode: "USD", phoneCode: "+1", locales: ["en-US", "es-US"] },
  { code: "GB", name: "United Kingdom", currencyCode: "GBP", phoneCode: "+44", locales: ["en-GB"] },
  { code: "AE", name: "United Arab Emirates", currencyCode: "AED", phoneCode: "+971", locales: ["en-AE", "ar-AE"] },
  { code: "CA", name: "Canada", currencyCode: "CAD", phoneCode: "+1", locales: ["en-CA", "fr-CA"] },
  { code: "AU", name: "Australia", currencyCode: "AUD", phoneCode: "+61", locales: ["en-AU"] },
  { code: "SG", name: "Singapore", currencyCode: "SGD", phoneCode: "+65", locales: ["en-SG", "zh-SG", "ms-SG", "ta-SG"] },
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

export function getCountryFlag(value) {
  const country = getCountryByCode(value);
  if (!country) return "";
  return String.fromCodePoint(...[...country.code].map((char) => 127397 + char.charCodeAt(0)));
}

/** Returns a copy so callers cannot mutate the canonical registry. */
export function listSelectableCountries() {
  return COUNTRY_REGISTRY.map((country) => ({
    ...country,
    locales: [...country.locales],
  }));
}
