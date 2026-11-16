import test from "node:test";
import assert from "node:assert/strict";
import { formatMinorCurrency } from "../money/format-minor-currency.js";

test("formats minor units using the explicit ISO precision without float conversion", () => {
  assert.equal(formatMinorCurrency(123456, { currencyCode: "USD", locale: "en-US" }), "$1,234.56");
  assert.equal(formatMinorCurrency(123456, { currencyCode: "EUR", locale: "de-DE" }), "1.234,56 €");
  assert.equal(formatMinorCurrency(1234, { currencyCode: "JPY", locale: "en-US" }), "¥1,234");
  assert.equal(formatMinorCurrency(1234, { currencyCode: "KWD", locale: "en-US" }), "KWD 1.234");
});
test("formats negative sub-unit amounts and bigint safely", () => {
  assert.equal(formatMinorCurrency(-5, { currencyCode: "USD", locale: "en-US" }), "-$0.05");
  assert.equal(formatMinorCurrency(12345678901234567890n, { currencyCode: "USD", locale: "en-US" }), "$123,456,789,012,345,678.90");
});
test("rejects unsupported currencies, unsafe numbers and implicit locales", () => {
  assert.throws(() => formatMinorCurrency(100, { currencyCode: "ZZZ", locale: "en-US" }), RangeError);
  assert.throws(() => formatMinorCurrency(Number.MAX_SAFE_INTEGER + 1, { currencyCode: "USD", locale: "en-US" }), TypeError);
  assert.throws(() => formatMinorCurrency(100, { currencyCode: "USD" }), TypeError);
});
