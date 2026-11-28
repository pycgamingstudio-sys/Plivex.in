import test from "node:test";
import assert from "node:assert/strict";
import { isValidIsoDate } from "../date-validation.js";

test("accepts valid ISO calendar dates", () => {
  for (const value of ["2026-11-28", "2024-02-29", "2000-02-29", "2026-04-30"]) {
    assert.equal(isValidIsoDate(value), true, value);
  }
});

test("rejects impossible calendar dates that Date.parse normalizes", () => {
  for (const value of ["2026-02-29", "2026-02-31", "2025-04-31", "2026-13-01", "2026-00-10", "2026-01-00"]) {
    assert.equal(isValidIsoDate(value), false, value);
  }
});

test("rejects malformed and non-string values", () => {
  for (const value of ["2026-1-01", "28-11-2026", "", null, undefined, 20261128]) {
    assert.equal(isValidIsoDate(value), false);
  }
});
