import test from "node:test";
import assert from "node:assert/strict";
import { CASHFREE_CURRENCIES, GLOBAL_BILLING, formatPlanPrice, getBillingForCountry } from "../billing/pricing.js";

test("all seven supported countries have explicit local currencies and prices", () => {
  assert.deepEqual(Object.keys(GLOBAL_BILLING).sort(), ["AE","AU","CA","GB","IN","SG","US"]);
  for (const config of Object.values(GLOBAL_BILLING)) {
    assert.equal(typeof config.currency, "string");
    assert.ok(config.monthly.basic > 0 && config.monthly.pro > config.monthly.basic);
  }
});

test("Cashfree currency allowlist does not overstate AED availability", () => {
  assert.deepEqual(CASHFREE_CURRENCIES, ["INR","USD","GBP","CAD","AUD","SGD"]);
  assert.equal(getBillingForCountry("AE").paymentEnabled, false);
  assert.equal(getBillingForCountry("US").currency, "USD");
});

test("unknown country is not silently converted to India", () => {
  assert.equal(getBillingForCountry("ZZ"), null);
});

test("price formatter uses exact minor-unit amount and currency", () => {
  assert.equal(formatPlanPrice(599, "USD", "en-US"), "$5.99");
  assert.throws(() => formatPlanPrice(-1, "USD"), TypeError);
});
