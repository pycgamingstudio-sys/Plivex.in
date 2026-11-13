/**
 * Locale-aware display formatting for the isolated Global edition.
 *
 * This module formats values only. It does not calculate tax, convert currency,
 * store ledger values, or define accounting precision. Callers must provide
 * authoritative amounts and an explicit ISO 4217 currency code.
 */

function assertCurrencyCode(currencyCode) {
  if (typeof currencyCode !== "string" || !/^[A-Z]{3}$/.test(currencyCode)) {
    throw new TypeError("currencyCode must be an uppercase ISO 4217 code");
  }
}

function assertLocale(locale) {
  if (typeof locale !== "string" || !locale.trim()) {
    throw new TypeError("locale must be an explicit BCP 47 locale");
  }
  try {
    // Intl.Locale validates the tag without guessing a user's locale.
    new Intl.Locale(locale);
  } catch {
    throw new RangeError("locale must be a valid BCP 47 locale");
  }
}

/**
 * Format an amount without performing arithmetic or currency conversion.
 * Number values must be finite; bigint is accepted for integer amounts.
 */
export function formatCurrency(amount, { currencyCode, locale } = {}) {
  assertCurrencyCode(currencyCode);
  assertLocale(locale);

  if (typeof amount !== "bigint" && (typeof amount !== "number" || !Number.isFinite(amount))) {
    throw new TypeError("amount must be a finite number or bigint");
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
  }).format(amount);
}

/** Format a finite quantity using an explicitly supplied locale. */
export function formatNumber(value, { locale, maximumFractionDigits } = {}) {
  assertLocale(locale);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("value must be a finite number");
  }
  if (maximumFractionDigits !== undefined
    && (!Number.isInteger(maximumFractionDigits) || maximumFractionDigits < 0 || maximumFractionDigits > 20)) {
    throw new RangeError("maximumFractionDigits must be an integer from 0 to 20");
  }

  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
  }).format(value);
}
