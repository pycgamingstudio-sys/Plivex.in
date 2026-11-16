import test from "node:test";
import assert from "node:assert/strict";
import { getCountryCapabilities, listCountryCapabilities } from "../countries/capability-matrix.js";

test("capability matrix explicitly covers all seven enabled countries", () => {
  assert.deepEqual(listCountryCapabilities().map((x) => x.countryCode).sort(), ["AE","AU","CA","GB","IN","SG","US"]);
});
test("US and Canada require jurisdiction-specific verified rules", () => {
  assert.equal(getCountryCapabilities("US").automaticTax, "verified_rule_required");
  assert.equal(getCountryCapabilities("CA").automaticTax, "verified_rule_required");
});
test("unsupported country does not inherit a default capability", () => {
  assert.equal(getCountryCapabilities("ZZ"), null);
});
