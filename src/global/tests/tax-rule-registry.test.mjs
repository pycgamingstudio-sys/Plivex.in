import test from "node:test";
import assert from "node:assert/strict";
import {
  TAX_ENGINE_VERSION,
  TAX_RULE_CATALOG_VERSION,
  getTaxCountryProfile,
  getTaxRuleSet,
  listTaxCountryProfiles,
  listTaxRuleSets,
  normalizeTaxCountryCode,
} from "../tax/tax-rule-registry.js";
import { getCountryStandardRateRule } from "../tax/standard-rate-rules.js";
import { calculateGlobalTax } from "../tax/global-tax-engine.js";

test("tax engine and catalogue expose explicit semantic versions", () => {
  assert.equal(TAX_ENGINE_VERSION, "1.0.0");
  assert.match(TAX_RULE_CATALOG_VERSION, /^\d{4}\.\d{2}\.\d+$/);
});

test("all seven selectable countries have an explicit tax readiness profile", () => {
  const profiles = listTaxCountryProfiles();
  assert.deepEqual(profiles.map((profile) => profile.countryCode).sort(), ["AE", "AU", "CA", "GB", "IN", "SG", "US"]);
  for (const profile of profiles) {
    assert.ok(profile.taxSystem);
    assert.ok(profile.currencyCode);
    assert.ok(profile.ruleMode);
    assert.ok(profile.issuance);
    assert.ok(profile.coverage);
  }
});

test("only four previously reviewed standard-rate baselines are available", () => {
  const expected = { GB: 2000, AE: 500, AU: 1000, SG: 900 };
  for (const [countryCode, rateBps] of Object.entries(expected)) {
    const result = getTaxRuleSet(countryCode, { asOfDate: "2026-11-15" });
    assert.equal(result.ok, true, countryCode);
    assert.equal(result.rule.rateBps, rateBps, countryCode);
    assert.equal(result.rule.version, "2026.11");
    assert.equal(result.rule.reviewedOn, "2026-11-14");
    assert.equal(result.rule.coverage, "standard-rate-only");
    assert.ok(result.rule.sourceAuthority);
    assert.ok(result.rule.components.length);
  }
});

test("India, US and Canada never receive an invented national Global rate", () => {
  assert.equal(getTaxRuleSet("IN").code, "INDIA_LEGACY_ADAPTER_REQUIRED");
  assert.equal(getTaxRuleSet("US").code, "JURISDICTION_RULE_REQUIRED");
  assert.equal(getTaxRuleSet("CA").code, "CANADIAN_PROVINCE_REQUIRED");
  assert.equal(getCountryStandardRateRule("US"), null);
  assert.equal(getCountryStandardRateRule("CA"), null);
});

test("Canadian province rules include federal and general provincial sales-tax components", () => {
  const expected = {
    AB: 500, BC: 1200, MB: 1200, NB: 1500, NL: 1500, NS: 1400,
    NT: 500, NU: 500, ON: 1300, PE: 1500, QC: 1497.5, SK: 1100, YT: 500,
  };
  for (const [province, rateBps] of Object.entries(expected)) {
    const result = getTaxRuleSet("CA", { jurisdictionId: province, asOfDate: "2026-11-20" });
    assert.equal(result.ok, true, province);
    assert.equal(result.rule.rateBps, rateBps, province);
    assert.equal(result.rule.jurisdictionId, province);
    assert.ok(result.rule.components.every((component) => component.source.startsWith("https://")));
  }
  assert.deepEqual(
    getTaxRuleSet("CA", { jurisdictionId: "BC", asOfDate: "2026-11-20" }).rule.components.map((item) => [item.name, item.rateBps]),
    [["GST", 500], ["PST", 700]],
  );
  assert.deepEqual(
    getTaxRuleSet("CA", { jurisdictionId: "QC", asOfDate: "2026-11-20" }).rule.components.map((item) => [item.name, item.rateBps]),
    [["GST", 500], ["QST", 997.5]],
  );
});

test("Canadian fractional QST rate calculates exactly with integer minor-unit arithmetic", () => {
  const result = calculateGlobalTax({
    countryCode: "CA", jurisdictionId: "QC", jurisdictionAttestedByUser: true,
    collectionObligationAttestedByUser: true,
    currencyCode: "CAD", currencyMinorUnits: 2, amountMinor: 10000,
    invoiceDate: "2026-11-20",
    sellerRegistration: {
      verified: false, attestedByUser: true, status: "registered",
      registrationNumber: "CA-QC-123", effectiveFrom: "2026-01-01",
    },
    placeOfSupplyVerified: true, placeOfSupply: "QC",
    taxCategoryVerified: true, taxCategory: "standard-rated",
    treatment: "standard", priceMode: "exclusive",
  });
  assert.equal(result.ok, true, result.message || result.code);
  assert.equal(result.taxMinor, 1498);
  assert.equal(result.totalMinor, 11498);
  assert.deepEqual(result.components.map((item) => item.rateBps), [500, 997.5]);
});

test("unsupported and malformed country codes fail closed", () => {
  assert.equal(getTaxRuleSet("DE").code, "COUNTRY_TAX_NOT_CONFIGURED");
  assert.equal(getTaxRuleSet("ZZ").code, "COUNTRY_TAX_NOT_CONFIGURED");
  assert.equal(getTaxRuleSet("USA").code, "INVALID_COUNTRY_CODE");
  assert.equal(getTaxRuleSet(null).code, "INVALID_COUNTRY_CODE");
  assert.equal(normalizeTaxCountryCode(" gb "), "GB");
});

test("rule selection validates invoice dates and legal effective windows", () => {
  assert.equal(getTaxRuleSet("GB", { asOfDate: "2026-02-30" }).code, "INVALID_RULE_AS_OF_DATE");
  assert.equal(getTaxRuleSet("GB", { asOfDate: "2011-01-03" }).code, "NO_EFFECTIVE_TAX_RULE");
  assert.equal(getTaxRuleSet("GB", { asOfDate: "2011-01-04" }).ok, true);
  assert.equal(getTaxRuleSet("SG", { asOfDate: "2023-12-31" }).code, "NO_EFFECTIVE_TAX_RULE");
  assert.equal(getTaxRuleSet("SG", { asOfDate: "2024-01-01" }).ok, true);
});

test("callers receive defensive copies and cannot mutate catalogue rules", () => {
  const first = getTaxRuleSet("GB");
  first.rule.components[0].rateBps = 1;
  first.rule.components.push({ id: "fake", rateBps: 1 });
  first.rule.source = "https://example.invalid";
  assert.equal(getTaxRuleSet("GB").rule.rateBps, 2000);
  assert.equal(getTaxRuleSet("GB").rule.components.length, 1);
  assert.equal(listTaxRuleSets().length, 4);
  const profiles = listTaxCountryProfiles();
  profiles[0].countryCode = "ZZ";
  assert.equal(getTaxCountryProfile("IN").countryCode, "IN");
});

test("existing standard-rate adapter preserves the evaluator contract", () => {
  const result = getCountryStandardRateRule("GB");
  assert.equal(result.verified, true);
  assert.equal(result.countryCode, "GB");
  assert.equal(result.components[0].rateBps, 2000);
  assert.equal(result.components[0].source, result.source);
});

test("global tax calculation preserves engine and catalogue provenance in its invoice snapshot", () => {
  const result = calculateGlobalTax({
    countryCode: "GB", currencyCode: "GBP", currencyMinorUnits: 2, amountMinor: 10000,
    invoiceDate: "2026-11-15",
    sellerRegistration: {
      verified: false, attestedByUser: true, status: "registered",
      registrationNumber: "GB-REG-123", effectiveFrom: "2026-01-01",
    },
    placeOfSupplyVerified: true, placeOfSupply: "GB",
    taxCategoryVerified: true, taxCategory: "standard-rated",
    treatment: "standard", priceMode: "exclusive",
  });
  assert.equal(result.ok, true);
  assert.equal(result.engineVersion, TAX_ENGINE_VERSION);
  assert.equal(result.ruleSnapshot.catalogVersion, TAX_RULE_CATALOG_VERSION);
  assert.equal(result.ruleSnapshot.sourceAuthority, "UK HM Revenue & Customs");
  assert.equal(result.ruleSnapshot.coverage, "standard-rate-only");
});
