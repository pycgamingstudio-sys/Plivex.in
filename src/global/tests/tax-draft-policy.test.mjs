import test from "node:test";
import assert from "node:assert/strict";
import { isDraftTaxRulesAllowed } from "../../../supabase/functions/_shared/tax/draft-tax-policy.mjs";

test("draft tax rules are disabled when the environment flag is absent", () => {
  assert.equal(isDraftTaxRulesAllowed(undefined), false);
  assert.equal(isDraftTaxRulesAllowed(""), false);
  assert.equal(isDraftTaxRulesAllowed("false"), false);
});

test("draft tax rules require an explicit true flag for test environments", () => {
  assert.equal(isDraftTaxRulesAllowed("true"), true);
  assert.equal(isDraftTaxRulesAllowed("TRUE"), false);
  assert.equal(isDraftTaxRulesAllowed("1"), false);
});
