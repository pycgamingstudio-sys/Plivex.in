import test from "node:test";
import assert from "node:assert/strict";
import { formatWorkspaceDate, formatWorkspaceDateTime } from "../localization/date-format.js";

test("workspace date formatting requires explicit locale and time zone", () => {
  const instant = "2026-01-02T03:04:00.000Z";
  assert.equal(formatWorkspaceDate(instant, { locale: "en-US", timeZone: "America/New_York" }), "Jan 01, 2026");
  assert.equal(formatWorkspaceDate(instant, { locale: "en-GB", timeZone: "Europe/London" }), "02 Jan 2026");
  assert.equal(formatWorkspaceDate(instant, { locale: "en-IN", timeZone: "Asia/Kolkata" }), "02 Jan 2026");
});

test("workspace date-time formatting honors regional locale and zone", () => {
  const result = formatWorkspaceDateTime("2026-01-02T03:04:00.000Z", {
    locale: "en-US", timeZone: "America/Los_Angeles", hour12: false,
  });
  assert.match(result, /Jan 01, 2026/);
});

test("date formatter rejects missing/invalid locale, time zone and date", () => {
  assert.throws(() => formatWorkspaceDate("2026-01-01", { timeZone: "UTC" }), TypeError);
  assert.throws(() => formatWorkspaceDate("2026-01-01", { locale: "en-US" }), TypeError);
  assert.throws(() => formatWorkspaceDate("2026-01-01", { locale: "en-US", timeZone: "Not/AZone" }), RangeError);
  assert.throws(() => formatWorkspaceDate("not-a-date", { locale: "en-US", timeZone: "UTC" }), TypeError);
});
