// Authoritative country/currency pricing for the Global edition.
// Values are in minor units; no FX conversion is performed.
export const GLOBAL_BILLING = Object.freeze({
  IN: Object.freeze({ currency: "INR", paymentEnabled: false, monthly: Object.freeze({ basic: 19900, pro: 24900 }), yearly: Object.freeze({ basic: 99900, pro: 159900 }) }),
  US: Object.freeze({ currency: "USD", paymentEnabled: false, monthly: Object.freeze({ basic: 599, pro: 999 }) }),
  GB: Object.freeze({ currency: "GBP", paymentEnabled: false, monthly: Object.freeze({ basic: 499, pro: 899 }) }),
  AE: Object.freeze({ currency: "AED", paymentEnabled: false, monthly: Object.freeze({ basic: 1900, pro: 3500 }) }),
  CA: Object.freeze({ currency: "CAD", paymentEnabled: false, monthly: Object.freeze({ basic: 799, pro: 1299 }) }),
  AU: Object.freeze({ currency: "AUD", paymentEnabled: false, monthly: Object.freeze({ basic: 799, pro: 1499 }) }),
  SG: Object.freeze({ currency: "SGD", paymentEnabled: false, monthly: Object.freeze({ basic: 699, pro: 1299 }) }),
});

export const CASHFREE_CURRENCIES = Object.freeze(["INR", "USD", "GBP", "CAD", "AUD", "SGD"]);

export function getBillingForCountry(countryCode) {
  if (typeof countryCode !== "string") return null;
  return GLOBAL_BILLING[countryCode.trim().toUpperCase()] || null;
}

export function formatPlanPrice(amountMinor, currency, locale) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new TypeError("Invalid minor-unit amount");
  return new Intl.NumberFormat(locale || "en", { style: "currency", currency }).format(amountMinor / 100);
}
