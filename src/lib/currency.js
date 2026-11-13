export const SUPPORTED_CURRENCIES = [
  { code: "INR", label: "INR · Indian Rupee (₹)", locale: "en-IN", major: "Rupees", minor: "Paise", fractionDigits: 2 },
  { code: "USD", label: "USD · US Dollar ($)", locale: "en-US", major: "Dollars", minor: "Cents", fractionDigits: 2 },
  { code: "EUR", label: "EUR · Euro (€)", locale: "de-DE", major: "Euros", minor: "Cents", fractionDigits: 2 },
  { code: "GBP", label: "GBP · British Pound (£)", locale: "en-GB", major: "Pounds", minor: "Pence", fractionDigits: 2 },
  { code: "AED", label: "AED · UAE Dirham (د.إ)", locale: "en-AE", major: "Dirhams", minor: "Fils", fractionDigits: 2 },
  { code: "CAD", label: "CAD · Canadian Dollar (CA$)", locale: "en-CA", major: "Dollars", minor: "Cents", fractionDigits: 2 },
  { code: "AUD", label: "AUD · Australian Dollar (A$)", locale: "en-AU", major: "Dollars", minor: "Cents", fractionDigits: 2 },
  { code: "SGD", label: "SGD · Singapore Dollar (S$)", locale: "en-SG", major: "Dollars", minor: "Cents", fractionDigits: 2 },
];

export const DEFAULT_CURRENCY = "INR";

export function isSupportedCurrency(code) {
  return SUPPORTED_CURRENCIES.some((currency) => currency.code === code);
}

export function getCurrencyLocale(currency = DEFAULT_CURRENCY) {
  const meta = SUPPORTED_CURRENCIES.find((item) => item.code === currency);
  if (!meta) throw new RangeError(`Unsupported currency: ${currency}`);
  return meta.locale;
}

function getCurrencyMeta(currency) {
  const meta = SUPPORTED_CURRENCIES.find((item) => item.code === currency);
  if (!meta) throw new RangeError(`Unsupported currency: ${currency}`);
  return meta;
}

export function formatMoney(value, currency = DEFAULT_CURRENCY, locale) {
  const meta = getCurrencyMeta(currency);
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new TypeError("Amount must be a finite number");
  return new Intl.NumberFormat(locale || meta.locale, {
    style: "currency",
    currency,
    minimumFractionDigits: meta.fractionDigits,
    maximumFractionDigits: meta.fractionDigits,
  }).format(amount);
}

function numberToWords(value) {
  const ones = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const chunk = (number) => {
    if (number < 20) return ones[number];
    if (number < 100) return `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ""}`;
    if (number < 1000) return `${ones[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${chunk(number % 100)}` : ""}`;
    if (number < 1000000) return `${chunk(Math.floor(number / 1000))} Thousand${number % 1000 ? ` ${chunk(number % 1000)}` : ""}`;
    if (number < 1000000000) return `${chunk(Math.floor(number / 1000000))} Million${number % 1000000 ? ` ${chunk(number % 1000000)}` : ""}`;
    return `${chunk(Math.floor(number / 1000000000))} Billion${number % 1000000000 ? ` ${chunk(number % 1000000000)}` : ""}`;
  };
  return chunk(Math.max(0, Math.floor(value)));
}

export function amountInWords(value, currency = DEFAULT_CURRENCY) {
  const meta = getCurrencyMeta(currency);
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new TypeError("Amount must be a finite non-negative number");
  const factor = 10 ** meta.fractionDigits;
  const safe = Math.round(amount * factor) / factor;
  const major = Math.floor(safe);
  const minor = Math.round((safe - major) * factor);
  const majorWords = numberToWords(major);
  if (!minor || meta.fractionDigits === 0) return `${majorWords} ${meta.major} Only`;
  return `${majorWords} ${meta.major} and ${numberToWords(minor)} ${meta.minor} Only`;
}
