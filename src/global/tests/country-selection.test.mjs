import test from "node:test";
import assert from "node:assert/strict";
import {
  COUNTRY_REGISTRY,
  getCountryByCode,
  listSelectableCountries,
} from "../countries/country-registry.js";
import {
  COUNTRY_SELECTION_SCHEMA_VERSION,
  COUNTRY_SELECTION_STORAGE_KEY,
  createBrowserCountrySelectionStore,
  createCountrySelectionStore,
  validateCountrySelection,
} from "../core/country-selection.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    inspect: (key) => data.get(key),
  };
}

test("registry contains unique ISO country and currency codes", () => {
  const countryCodes = COUNTRY_REGISTRY.map(({ code }) => code);
  assert.equal(new Set(countryCodes).size, countryCodes.length);
  for (const country of COUNTRY_REGISTRY) {
    assert.match(country.code, /^[A-Z]{2}$/);
    assert.match(country.currencyCode, /^[A-Z]{3}$/);
    assert.ok(country.locales.length > 0);
    assert.equal(country.capability, "identity-only");
  }
  assert.equal(Object.isFrozen(COUNTRY_REGISTRY), true);
});

test("country lookup normalizes valid codes and rejects malformed or unsupported values", () => {
  assert.equal(getCountryByCode("in").code, "IN");
  assert.equal(getCountryByCode(" GB ").code, "GB");
  for (const value of [null, undefined, 4, "", "I", "IND", "12", "ZZ", "IN;US"]) {
    assert.equal(getCountryByCode(value), null);
  }
});

test("listed country data is a defensive copy", () => {
  const copy = listSelectableCountries();
  copy[0].name = "Changed";
  copy[0].locales.push("xx");
  assert.equal(getCountryByCode("IN").name, "India");
  assert.equal(getCountryByCode("IN").locales.includes("xx"), false);
});

test("currency and language remain independent attributes", () => {
  const india = getCountryByCode("IN");
  const uae = getCountryByCode("AE");
  assert.equal(india.currencyCode, "INR");
  assert.deepEqual(india.locales, ["en-IN", "hi-IN"]);
  assert.equal(uae.currencyCode, "AED");
  assert.deepEqual(uae.locales, ["en-AE", "ar-AE"]);
  assert.notEqual(india.currencyCode, india.locales[0]);
});

test("selection validation never silently falls back to India", () => {
  assert.equal(validateCountrySelection("US").country.code, "US");
  for (const value of [undefined, null, "", "ZZ", "IND", 12]) {
    const result = validateCountrySelection(value);
    assert.equal(result.valid, false);
    assert.equal(result.country, null);
    assert.equal(result.error, "UNSUPPORTED_COUNTRY");
  }
});

test("nothing is saved until the user explicitly confirms a supported country", () => {
  const storage = memoryStorage();
  const store = createCountrySelectionStore(storage);
  assert.equal(store.read(), null);
  assert.deepEqual(store.save({ countryCode: "US" }), {
    saved: false,
    error: "EXPLICIT_CONFIRMATION_REQUIRED",
  });
  assert.equal(storage.inspect(COUNTRY_SELECTION_STORAGE_KEY), undefined);
  assert.equal(store.save({ countryCode: "ZZ", confirmed: true }).error, "UNSUPPORTED_COUNTRY");
  assert.equal(storage.inspect(COUNTRY_SELECTION_STORAGE_KEY), undefined);
});

test("confirmed selection persists and can be read and cleared", () => {
  const storage = memoryStorage();
  const store = createCountrySelectionStore(storage);
  const saved = store.save({ countryCode: " gb ", confirmed: true });
  assert.equal(saved.saved, true);
  assert.equal(saved.country.code, "GB");
  assert.equal(store.read().code, "GB");
  assert.equal(JSON.parse(storage.inspect(COUNTRY_SELECTION_STORAGE_KEY)).schemaVersion, COUNTRY_SELECTION_SCHEMA_VERSION);
  assert.equal(store.clear(), true);
  assert.equal(store.read(), null);
});

test("invalid, corrupt, and outdated stored records are ignored", () => {
  for (const raw of ["not-json", "null", "{}", JSON.stringify({ schemaVersion: 0, countryCode: "IN" }), JSON.stringify({ schemaVersion: 1, countryCode: "ZZ" })]) {
    const storage = memoryStorage({ [COUNTRY_SELECTION_STORAGE_KEY]: raw });
    assert.equal(createCountrySelectionStore(storage).read(), null);
  }
});

test("storage failures do not crash the application", () => {
  const brokenStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  const store = createCountrySelectionStore(brokenStorage);
  assert.equal(store.read(), null);
  assert.equal(store.save({ countryCode: "IN", confirmed: true }).error, "STORAGE_WRITE_FAILED");
  assert.equal(store.clear(), false);
});

test("missing browser storage is safe for SSR", () => {
  const store = createBrowserCountrySelectionStore();
  assert.equal(store.read(), null);
  assert.equal(store.save({ countryCode: "IN", confirmed: true }).error, "STORAGE_UNAVAILABLE");
});
