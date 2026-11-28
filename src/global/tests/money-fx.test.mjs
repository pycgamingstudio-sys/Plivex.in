import test from "node:test";
import assert from "node:assert/strict";
import { getCurrencyPrecision } from "../money/currency-precision.js";
import { convertMinorAmount, validateExchangeRateSnapshot } from "../money/exchange-rate.js";
const snapshot = {
  id: "fx-2026-11-16-usd-inr-1", baseCurrency: "USD", quoteCurrency: "INR",
  rateNumerator: "8350", rateDenominator: "100", effectiveAt: "2026-11-16T00:00:00Z",
  capturedAt: "2026-11-16T01:00:00Z", source: "https://rates.example.test/feed", provider: "Test fixture",
};
test("currency precision covers zero, two and three decimal examples and rejects inherited keys", () => {
  assert.equal(getCurrencyPrecision("JPY"), 0); assert.equal(getCurrencyPrecision("USD"), 2);
  assert.equal(getCurrencyPrecision("KWD"), 3); assert.equal(getCurrencyPrecision("ZZZ"), null);
  assert.equal(getCurrencyPrecision("constructor"), null); assert.equal(getCurrencyPrecision("toString"), null);
});
test("FX conversion uses integer rational arithmetic and preserves provenance", () => {
  const result = convertMinorAmount(100, snapshot);
  assert.equal(result.ok, true); assert.equal(result.quoteAmountMinor, 8350);
  assert.equal(result.snapshotId, snapshot.id); assert.equal(result.rounding, "half-up");
});
test("FX snapshots reject malformed, unsafe and future values", () => {
  assert.equal(validateExchangeRateSnapshot({ ...snapshot, rateNumerator: "0" }).code, "INVALID_RATE");
  assert.equal(validateExchangeRateSnapshot({ ...snapshot, effectiveAt: "2026-11-17T00:00:00Z" }).code, "FUTURE_EFFECTIVE_RATE");
  assert.equal(validateExchangeRateSnapshot({ ...snapshot, source: "http://rates.example.test" }).code, "INVALID_SOURCE");
  assert.equal(convertMinorAmount(Number.MAX_SAFE_INTEGER + 1, snapshot).code, "INVALID_AMOUNT");
});
test("conversion honors zero-decimal quote currency and signed amounts", () => {
  const result = convertMinorAmount(100, { ...snapshot, quoteCurrency: "JPY", rateNumerator: "150", rateDenominator: "1" });
  assert.equal(result.ok, true); assert.equal(result.quoteAmountMinor, 150);
  assert.equal(convertMinorAmount(-100, snapshot).quoteAmountMinor, -8350);
});

test("FX snapshot timestamps reject impossible calendar dates and invalid clock values", () => {
  assert.equal(validateExchangeRateSnapshot({ ...snapshot, effectiveAt: "2026-02-30T00:00:00Z" }).code, "INVALID_TIMESTAMP");
  assert.equal(validateExchangeRateSnapshot({ ...snapshot, capturedAt: "2026-11-16T25:00:00Z" }).code, "INVALID_TIMESTAMP");
  assert.equal(validateExchangeRateSnapshot({ ...snapshot, effectiveAt: "2024-02-29T00:00:00.1Z" }).ok, true);
});
