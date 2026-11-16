import { getCurrencyPrecision } from "./currency-precision.js";

function validateLocale(locale) {
  if (typeof locale !== "string" || !locale.trim()) throw new TypeError("An explicit BCP 47 locale is required");
  try { new Intl.Locale(locale); } catch { throw new RangeError("Invalid BCP 47 locale"); }
}

/** Format an integer minor-unit amount without converting through floating point. */
export function formatMinorCurrency(amountMinor, { currencyCode, locale } = {}) {
  const code = typeof currencyCode === "string" ? currencyCode.trim().toUpperCase() : currencyCode;
  const precision = getCurrencyPrecision(code);
  if (precision === null) throw new RangeError("Unsupported currency precision");
  validateLocale(locale);
  if (typeof amountMinor !== "bigint" && !Number.isSafeInteger(amountMinor)) {
    throw new TypeError("amountMinor must be a safe integer or bigint");
  }
  const amount = BigInt(amountMinor);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const scale = 10n ** BigInt(precision);
  const whole = absolute / scale;
  const fraction = precision === 0 ? 0n : absolute % scale;

  // Use a negative sentinel for values between -1 and 0 so Intl keeps the
  // locale-specific negative-sign placement even when the whole part is zero.
  const signedWhole = negative ? -(whole === 0n ? 1n : whole) : whole;
  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency", currency: code,
    minimumFractionDigits: precision, maximumFractionDigits: precision,
  });
  const wholeParts = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).formatToParts(whole);
  const localizedWhole = wholeParts.filter((part) => part.type === "integer" || part.type === "group");
  const localizedFraction = precision === 0 ? "" : new Intl.NumberFormat(locale, {
    useGrouping: false, minimumIntegerDigits: precision, maximumFractionDigits: 0,
  }).format(fraction);
  let integerIndex = 0;
  return currencyFormatter.formatToParts(signedWhole).map((part) => {
    if (part.type === "integer" || part.type === "group") return localizedWhole[integerIndex++]?.value ?? "";
    if (part.type === "fraction") return localizedFraction;
    return part.value;
  }).join("");
}
