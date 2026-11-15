import test from "node:test";
import assert from "node:assert/strict";
import { getCountryByCode, listSelectableCountries } from "../countries/country-registry.js";

test("country registry supplies correct calling codes and home currencies", () => {
  const expected = {
    IN: ["+91", "INR"],
    US: ["+1", "USD"],
    GB: ["+44", "GBP"],
    AE: ["+971", "AED"],
    CA: ["+1", "CAD"],
    AU: ["+61", "AUD"],
    SG: ["+65", "SGD"],
  };
  for (const [code, [phoneCode, currencyCode]] of Object.entries(expected)) {
    const country = getCountryByCode(code);
    assert.equal(country.phoneCode, phoneCode, code);
    assert.equal(country.currencyCode, currencyCode, code);
  }
});

test("country registry lookup remains fail-closed for unknown codes", () => {
  assert.equal(getCountryByCode("ZZ"), null);
  assert.equal(getCountryByCode(null), null);
  assert.equal(listSelectableCountries().length, 7);
});
