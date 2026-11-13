import test from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_CURRENCIES, amountInWords, formatMoney, getCurrencyLocale, isSupportedCurrency } from "../../lib/currency.js";
import { COUNTRY_REGISTRY } from "../countries/country-registry.js";

const EXPECTED_LOCALES = Object.freeze({
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AED: "en-AE",
  CAD: "en-CA",
  AUD: "en-AU",
  SGD: "en-SG",
});

test("every registered Global country currency is supported and has its expected locale", () => {
  for (const country of COUNTRY_REGISTRY) {
    assert.equal(isSupportedCurrency(country.currencyCode), true, country.code);
    assert.equal(getCurrencyLocale(country.currencyCode), EXPECTED_LOCALES[country.currencyCode], country.code);
  }
  assert.deepEqual(
    COUNTRY_REGISTRY.map((country) => country.currencyCode).sort(),
    SUPPORTED_CURRENCIES.filter((currency) => Object.hasOwn(EXPECTED_LOCALES, currency.code)).map((currency) => currency.code).sort(),
  );
});

test("currency formatting matches fixed locale-specific outputs and rejects unknown codes", () => {
  const knownOutputs = {
    CAD: "$1,234.50",
    AUD: "$1,234.50",
    SGD: "$1,234.50",
  };
  for (const [code, expected] of Object.entries(knownOutputs)) {
    const expectedLocale = EXPECTED_LOCALES[code];
    assert.equal(getCurrencyLocale(code), expectedLocale);
    assert.equal(formatMoney(1234.5, code, expectedLocale), expected);
    assert.equal(formatMoney(1234.5, code), expected);
  }
  assert.throws(() => formatMoney(12, "XYZ"), RangeError);
  assert.throws(() => getCurrencyLocale("XYZ"), RangeError);
});

test("amount in words uses supported currency names and two-digit minor units", () => {
  assert.equal(amountInWords(12.34, "CAD"), "Twelve Dollars and Thirty Four Cents Only");
  assert.equal(amountInWords(12.34, "AUD"), "Twelve Dollars and Thirty Four Cents Only");
  assert.equal(amountInWords(12.34, "SGD"), "Twelve Dollars and Thirty Four Cents Only");
  assert.throws(() => amountInWords(-1, "USD"), TypeError);
});
