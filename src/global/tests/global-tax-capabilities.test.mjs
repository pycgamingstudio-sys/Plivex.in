import test from "node:test";
import assert from "node:assert/strict";
import { getGlobalTaxCapability, listGlobalTaxCapabilities } from "../tax/global-tax-capabilities.js";
import { calculateGlobalTax } from "../tax/global-tax-engine.js";

test("capability matrix distinguishes India legacy, Global calculation and issuance readiness", () => {
  assert.equal(getGlobalTaxCapability("IN").calculation, "india_legacy");
  assert.equal(getGlobalTaxCapability("GB").calculation, "standard_rate_baseline");
  assert.equal(getGlobalTaxCapability("GB").issuance, "standard_rate_only");
  for (const code of ["AE", "AU", "SG"]) {
    assert.equal(getGlobalTaxCapability(code).calculation, "standard_rate_baseline");
    assert.equal(getGlobalTaxCapability(code).issuance, "standard_rate_only");
  }
  assert.equal(getGlobalTaxCapability("CA").calculation, "verified_jurisdiction_rule_required");
  assert.equal(getGlobalTaxCapability("CA").issuance, "standard_rate_only");
  assert.equal(getGlobalTaxCapability("US").calculation, "verified_jurisdiction_rule_required");
  assert.equal(getGlobalTaxCapability("US").issuance, "disabled");
});

test("unconfigured ISO countries and malformed codes fail closed", () => {
  for (const code of ["DE", "FR", "JP", "BR", "ZA", "NZ", "MX", "NG"]) {
    const capability = getGlobalTaxCapability(code);
    assert.equal(capability.status, "not_configured");
    assert.equal(capability.calculation, "not_configured");
    assert.equal(capability.issuance, "disabled");
    assert.equal(calculateGlobalTax({ countryCode: code }).code, "UNSUPPORTED_COUNTRY");
  }
  assert.equal(getGlobalTaxCapability("not-a-country").code, "INVALID_COUNTRY_CODE");
  assert.equal(getGlobalTaxCapability(null).code, "INVALID_COUNTRY_CODE");
});

test("capability listing is defensive and cannot mutate canonical policy", () => {
  const first = listGlobalTaxCapabilities();
  first[0].countryCode = "ZZ";
  assert.equal(getGlobalTaxCapability("IN").countryCode, "IN");
  assert.equal(listGlobalTaxCapabilities().length, 7);
});
