import test from "node:test";
import assert from "node:assert/strict";
import { getCountryExperience, listCountryExperiences } from "../countries/country-experience.js";

test("all seven selectable countries have complete experience metadata", () => {
  const experiences = listCountryExperiences();
  assert.equal(experiences.length, 7);
  for (const item of experiences) {
    assert.ok(item.currencyCode);
    assert.ok(item.defaultLocale);
    assert.ok(item.locales.includes(item.defaultLocale));
    assert.ok(["ltr", "rtl"].includes(item.direction));
    assert.ok(item.address.regionLabel);
    assert.ok(item.address.postalCodeLabel);
    assert.ok(item.business.registrationLabel);
    assert.ok(item.business.taxName);
    assert.ok(item.document.taxInvoiceTitle);
    assert.ok(item.taxCapabilityKey);
  }
});

test("country experience keeps regional identity distinct from tax capability", () => {
  assert.equal(getCountryExperience("IN").business.taxName, "GST");
  assert.equal(getCountryExperience("US").business.taxName, "Sales tax");
  assert.equal(getCountryExperience("GB").business.taxName, "VAT");
  assert.equal(getCountryExperience("AE").address.regionLabel, "Emirate");
  assert.equal(getCountryExperience("CA").address.regionLabel, "Province / territory");
  assert.equal(getCountryExperience("AU").business.registrationLabel, "ABN");
  assert.equal(getCountryExperience("SG").address.postalCodeLabel, "Postal code");
  assert.equal(getCountryExperience("US").timeZonePolicy, "workspace-select");
  assert.equal(getCountryExperience("CA").timeZonePolicy, "workspace-select");
});

test("unknown countries fail closed and returned nested metadata cannot mutate registry", () => {
  assert.equal(getCountryExperience("ZZ"), null);
  assert.equal(getCountryExperience(null), null);
  const profile = getCountryExperience("US");
  assert.throws(() => { profile.address.postalCodeLabel = "wrong"; }, TypeError);
  assert.equal(getCountryExperience("US").address.postalCodeLabel, "ZIP code");
});
