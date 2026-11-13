import test from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_CURRENCIES, amountInWords, formatMoney, getCurrencyLocale, isSupportedCurrency } from "../../lib/currency.js";
import { COUNTRY_REGISTRY } from "../countries/country-registry.js";

test("every registered Global country currency is supported by invoice formatting", () => {
  for (const country of COUNTRY_REGISTRY) {
    assert.equal(isSupportedCurrency(country.currencyCode), true, country.code);
    assert.ok(getCurrencyLocale(country.currencyCode));
  }
  assert.deepEqual(
    COUNTRY_REGISTRY.map((country) => country.currencyCode).sort(),
    SUPPORTED_CURRENCIES.filter((currency) => ["INR", "USD", "GBP", "AED", "CAD", "AUD", "SGD"].includes(currency.code)).map((currency) => currency.code).sort(),
  );
});

test("currency formatting uses each currency locale and rejects unknown codes", () => {
  for (const code of ["CAD", "AUD", "SGD"]) {
    const locale = getCurrencyLocale(code);
    const expected = new Intl.NumberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1234.5);
    assert.equal(formatMoney(1234.5, code), expected);
  }
  assert.throws(() => formatMoney(12, "XYZ"), RangeError);
});

test("amount in words uses supported currency names and two-digit minor units", () => {
  assert.equal(amountInWords(12.34, "CAD"), "Twelve Dollars and Thirty Four Cents Only");
  assert.equal(amountInWords(12.34, "AUD"), "Twelve Dollars and Thirty Four Cents Only");
  assert.equal(amountInWords(12.34, "SGD"), "Twelve Dollars and Thirty Four Cents Only");
  assert.throws(() => amountInWords(-1, "USD"), TypeError);
});
