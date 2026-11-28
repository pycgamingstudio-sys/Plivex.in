import { getCurrencyPrecision, assertMinorAmount } from "./currency-precision.js";

const isDate = (value) => {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,3})?Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const expected = value.replace(/(?:[.]([0-9]{1,3}))?Z$/, (_, fraction) => `.${(fraction || "").padEnd(3, "0")}Z`);
  return new Date(timestamp).toISOString() === expected;
};
const positiveIntegerString = (v) => typeof v === "string" && /^[1-9]\d{0,37}$/.test(v);
const roundHalfUp = (n, d) => {
  const sign = n < 0n ? -1n : 1n;
  const absolute = n < 0n ? -n : n;
  return sign * ((absolute + d / 2n) / d);
};

/** Validate an immutable, source-attributed rational exchange-rate snapshot. */
export function validateExchangeRateSnapshot(snapshot, nowMs = Date.now()) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return { ok: false, code: "INVALID_SNAPSHOT" };
  const base = typeof snapshot.baseCurrency === "string" ? snapshot.baseCurrency.toUpperCase() : "";
  const quote = typeof snapshot.quoteCurrency === "string" ? snapshot.quoteCurrency.toUpperCase() : "";
  if (getCurrencyPrecision(base) === null || getCurrencyPrecision(quote) === null) return { ok: false, code: "UNSUPPORTED_CURRENCY" };
  if (base === quote) return { ok: false, code: "SAME_CURRENCY" };
  if (!positiveIntegerString(snapshot.rateNumerator) || !positiveIntegerString(snapshot.rateDenominator)) return { ok: false, code: "INVALID_RATE" };
  if (!isDate(snapshot.capturedAt) || !isDate(snapshot.effectiveAt)) return { ok: false, code: "INVALID_TIMESTAMP" };
  if (!Number.isFinite(nowMs)) return { ok: false, code: "INVALID_VALIDATION_TIME" };
  if (Date.parse(snapshot.capturedAt) > nowMs) return { ok: false, code: "FUTURE_CAPTURE_TIMESTAMP" };
  if (Date.parse(snapshot.effectiveAt) > Date.parse(snapshot.capturedAt)) return { ok: false, code: "FUTURE_EFFECTIVE_RATE" };
  let source;
  try { source = new URL(snapshot.source); } catch { return { ok: false, code: "INVALID_SOURCE" }; }
  if (source.protocol !== "https:" || !source.hostname || source.username || source.password) return { ok: false, code: "INVALID_SOURCE" };
  if (typeof snapshot.provider !== "string" || !snapshot.provider.trim() || snapshot.provider.length > 100) return { ok: false, code: "INVALID_PROVIDER" };
  if (typeof snapshot.id !== "string" || !snapshot.id.trim() || snapshot.id.length > 120) return { ok: false, code: "INVALID_ID" };
  return { ok: true, snapshot: Object.freeze({ ...snapshot, baseCurrency: base, quoteCurrency: quote }) };
}

/** Convert integer minor units using a rational snapshot, never binary floating point. */
export function convertMinorAmount(amountMinor, snapshot) {
  const checked = validateExchangeRateSnapshot(snapshot);
  if (!checked.ok) return checked;
  let base;
  try { base = assertMinorAmount(amountMinor, checked.snapshot.baseCurrency); }
  catch (error) { return { ok: false, code: error instanceof RangeError ? "UNSUPPORTED_CURRENCY" : "INVALID_AMOUNT" }; }
  const quotePrecision = getCurrencyPrecision(checked.snapshot.quoteCurrency);
  const numerator = BigInt(base.amountMinor)
    * BigInt(checked.snapshot.rateNumerator)
    * (10n ** BigInt(quotePrecision));
  const denominator = BigInt(checked.snapshot.rateDenominator)
    * (10n ** BigInt(base.minorUnits));
  const converted = roundHalfUp(numerator, denominator);
  if (converted > BigInt(Number.MAX_SAFE_INTEGER) || converted < BigInt(Number.MIN_SAFE_INTEGER)) return { ok: false, code: "AMOUNT_OVERFLOW" };
  return {
    ok: true, baseAmountMinor: base.amountMinor, quoteAmountMinor: Number(converted),
    baseCurrency: base.currencyCode, quoteCurrency: checked.snapshot.quoteCurrency,
    snapshotId: checked.snapshot.id, rateNumerator: checked.snapshot.rateNumerator,
    rateDenominator: checked.snapshot.rateDenominator, capturedAt: checked.snapshot.capturedAt,
    effectiveAt: checked.snapshot.effectiveAt, source: checked.snapshot.source, rounding: "half-up",
  };
}
