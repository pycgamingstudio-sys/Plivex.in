import test from "node:test";
import assert from "node:assert/strict";
import { validateGlobalBranchAction, validateGlobalBranchAgainstContext } from "./assistant-global-branch-validation.mjs";

test("validates and normalizes a Main Workspace branch", () => {
  assert.deepEqual(validateGlobalBranchAction({ type: "create_global_branch", payload: {
    name: "  Delhi Office ", branch_code: " del-01 ", address: { city: "Delhi", country_code: "in", postal_code: "110001" }
  }}), { type: "create_global_branch", payload: {
    name: "Delhi Office", branch_code: "DEL-01",
    address: { line1: "", line2: "", city: "Delhi", state: "", postal_code: "110001", country_code: "IN" }
  }});
});

test("rejects missing names and unsafe branch codes", () => {
  assert.equal(validateGlobalBranchAction({ type: "create_global_branch", payload: { branch_code: "DEL-1" } }), null);
  assert.equal(validateGlobalBranchAction({ type: "create_global_branch", payload: { name: "Delhi", branch_code: "bad code" } }), null);
  assert.equal(validateGlobalBranchAction({ type: "create_global_branch", payload: { name: "Delhi", branch_code: "x".repeat(33) } }), null);
});

test("bounds address fields and rejects malformed country codes", () => {
  const result = validateGlobalBranchAction({ type: "create_global_branch", payload: {
    name: "Delhi", branch_code: "DEL", address: { city: "C".repeat(140), country_code: "IND" }
  }});
  assert.equal(result, null);
  const bounded = validateGlobalBranchAction({ type: "create_global_branch", payload: {
    name: "Delhi", branch_code: "DEL", address: { city: "C".repeat(140) }
  }});
  assert.equal(bounded.payload.address.city.length, 100);
});

test("rejects branch codes or names already present in live Main Workspace context", () => {
  const action = validateGlobalBranchAction({ type: "create_global_branch", payload: { name: "Delhi Office", branch_code: "DEL-01" } });
  assert.equal(validateGlobalBranchAgainstContext(action, { branches: [{ name: "Other", branch_code: "DEL-01" }] }).reason, "duplicate_code");
  assert.equal(validateGlobalBranchAgainstContext(action, { branches: [{ name: " delhi office ", branch_code: "DL" }] }).reason, "duplicate_name");
  assert.equal(validateGlobalBranchAgainstContext(action, { context_unavailable: true, branches: [] }).reason, "context_unavailable");
  assert.equal(validateGlobalBranchAgainstContext(action, { branches: [] }).ok, true);
});
