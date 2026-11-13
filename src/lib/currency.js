export const SUPPORTED_CURRENCIES = [
  { code: "INR", label: "INR · Indian Rupee (₹)", locale: "en-IN", major: "Rupees", minor: "Paise" },
  { code: "USD", label: "USD · US Dollar ($)", locale: "en-US", major: "Dollars", minor: "Cents" },
  { code: "EUR", label: "EUR · Euro (€)", locale: "de-DE", major: "Euros", minor: "Cents" },
  { code: "GBP", label: "GBP · British Pound (£)", locale: "en-GB", major: "Pounds", minor: "Pence" },
  { code: "AED", label: "AED · UAE Dirham (د.إ)", locale: "en-AE", major: "Dirhams", minor: "Fils" },
];

export const DEFAULT_CURRENCY = "INR";

export function isSupportedCurrency(code) {
  return SUPPORTED_CURRENCIES.some((currency) => currency.code === code);
}

export function formatMoney(value, currency = DEFAULT_CURRENCY) {
  const safeCurrency = isSupportedCurrency(currency) ? currency : DEFAULT_CURRENCY;
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat(SUPPORTED_CURRENCIES.find((item) => item.code === safeCurrency).locale, {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
  const meta = SUPPORTED_CURRENCIES.find((item) => item.code === currency) || SUPPORTED_CURRENCIES[0];
  const safe = Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
  const major = Math.floor(safe);
  const minor = Math.round((safe - major) * 100);
  const majorWords = numberToWords(major);
  return minor
    ? `${majorWords} ${meta.major} and ${numberToWords(minor)} ${meta.minor} Only`
    : `${majorWords} ${meta.major} Only`;
}
