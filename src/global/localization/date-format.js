/**
 * Explicit-locale date/time formatting for country-aware workspace screens.
 * Time zone is required; callers must resolve a workspace-selected zone for
 * countries spanning multiple zones. This module never guesses from the device.
 */
function assertLocale(locale) {
  if (typeof locale !== "string" || !locale.trim()) throw new TypeError("locale is required");
  try { new Intl.Locale(locale); } catch { throw new RangeError("locale must be a valid BCP 47 locale"); }
}

function assertTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) throw new TypeError("timeZone is required");
  try { new Intl.DateTimeFormat("en", { timeZone }).format(0); } catch { throw new RangeError("timeZone must be a valid IANA time zone"); }
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("value must be a valid date");
  return date;
}

export function formatWorkspaceDate(value, { locale, timeZone, options = {} } = {}) {
  assertLocale(locale);
  assertTimeZone(timeZone);
  // Calendar dates (YYYY-MM-DD) are not instants. Keep the entered day stable
  // across time zones rather than shifting it into the previous/next day.
  const dateOnly = typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value);
  const date = dateOnly ? toDate(`${value}T00:00:00.000Z`) : toDate(value);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "2-digit", timeZone: dateOnly ? "UTC" : timeZone, ...options,
  }).format(date);
}

export function formatWorkspaceDateTime(value, { locale, timeZone, options = {} } = {}) {
  assertLocale(locale);
  assertTimeZone(timeZone);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone, ...options,
  }).format(toDate(value));
}
