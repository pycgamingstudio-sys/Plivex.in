import test from "node:test";
import assert from "node:assert/strict";
import { formatCurrency, formatNumber } from "../localization/number-format.js";

test("currency display uses explicit currency and locale", () => {
  assert.equal(formatCurrency(1234.5, { currencyCode: "USD", locale: "en-US" }), "$1,234.50");
  assert.equal(formatCurrency(1234.5, { currencyCode: "EUR", locale: "de-DE" }), "1.234,50 €");
  assert.equal(formatCurrency(1234.5, { currencyCode: "INR", locale: "en-IN" }), "₹1,234.50");
});

test("currency formatting supports integer bigint amounts", () => {
  assert.equal(formatCurrency(1234n, { currencyCode: "JPY", locale: "ja-JP" }), "￥1,234");
});

test("currency formatter rejects ambiguous or invalid inputs", () => {
  for (const currencyCode of [undefined, "", "usd", "US", "USDX", 123]) {
    assert.throws(() => formatCurrency(10, { currencyCode, locale: "en-US" }), TypeError);
  }
  for (const amount of [NaN, Infinity, -Infinity, "10", null, {}]) {
    assert.throws(() => formatCurrency(amount, { currencyCode: "USD", locale: "en-US" }), TypeError);
  }
  assert.throws(() => formatCurrency(10, { currencyCode: "USD" }), TypeError);
  assert.throws(() => formatCurrency(10, { currencyCode: "USD", locale: "not_a_locale" }), RangeError);
});

test("number formatting uses the explicit locale and bounded precision", () => {
  assert.equal(formatNumber(1234.5, { locale: "de-DE", maximumFractionDigits: 1 }), "1.234,5");
  assert.equal(formatNumber(1234.5, { locale: "en-US", maximumFractionDigits: 0 }), "1,235");
  assert.throws(() => formatNumber(Infinity, { locale: "en-US" }), TypeError);
  assert.throws(() => formatNumber(1, { locale: "en-US", maximumFractionDigits: 21 }), RangeError);
  assert.throws(() => formatNumber(1, {}), TypeError);
});
