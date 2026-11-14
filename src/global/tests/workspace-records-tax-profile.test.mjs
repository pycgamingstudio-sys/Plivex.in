import test from "node:test";
import assert from "node:assert/strict";
import { isIsoCalendarDate } from "../../../supabase/functions/workspace-records/validation.mjs";

test("registered tax profile effective date accepts valid ISO calendar dates", () => {
  assert.equal(isIsoCalendarDate("2026-11-14"), true);
  assert.equal(isIsoCalendarDate("2024-02-29"), true);
});

test("registered tax profile effective date rejects malformed and impossible dates", () => {
  for (const value of ["2025-02-29", "2026-13-01", "2026-04-31", "14-11-2026", "2026-11-14extra", "", null]) {
    assert.equal(isIsoCalendarDate(value), false, String(value));
  }
});
