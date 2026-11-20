import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getCountryByCode, getCountryFlag } from "../countries/country-registry.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("country choices provide flag markers and keep Hindi exclusive to India", () => {
  assert.equal(getCountryFlag("IN"), "🇮🇳");
  assert.equal(getCountryFlag("US"), "🇺🇸");
  assert.deepEqual(getCountryByCode("IN").locales, ["en-IN", "hi-IN"]);
  for (const code of ["US", "GB", "AE", "CA", "AU", "SG"]) {
    assert.ok(!getCountryByCode(code).locales.some((locale) => locale.startsWith("hi")));
  }
});

test("pricing requires an explicit country choice rather than guessing India from browser locale", async () => {
  const pricing = await read("../../components/landing/PricingSection.jsx");
  assert.match(pricing, /Select country to see pricing/);
  assert.match(pricing, /useState\(""/);
  assert.doesNotMatch(pricing, /getInitialBillingCountry|navigator\.language/);
});

test("Global onboarding asks for a business name and omits a redundant single-language selector", async () => {
  const onboarding = await read("../../components/global/GlobalCountryOnboarding.jsx");
  assert.match(onboarding, /global-business-name/);
  assert.match(onboarding, /locales\.length > 1/);
  assert.match(onboarding, /full_name: businessName\.trim\(\)/);
});

test("Global settings hide the India-only Hindi language toggle", async () => {
  const settings = await read("../../pages/Settings.jsx");
  const switcher = await read("../../components/LanguageSwitcher.jsx");
  assert.match(settings, /showHindi=\{APP_EDITION !== "global"\}/);
  assert.match(switcher, /showHindi && btn\("hi"/);
});
