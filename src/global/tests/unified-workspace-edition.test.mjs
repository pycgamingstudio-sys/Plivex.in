import test from "node:test";
import assert from "node:assert/strict";
import { resolveEditionId, resolveWorkspaceEdition } from "../core/edition-contract.js";

const supportedCountries = ["US", "GB", "AE", "CA", "AU", "SG"];

test("India workspace keeps the existing India edition regardless of case or whitespace", () => {
  assert.equal(resolveWorkspaceEdition("IN", supportedCountries), "india");
  assert.equal(resolveWorkspaceEdition(" in ", supportedCountries), "india");
});

test("supported non-India workspaces use Global regional behavior in the same app", () => {
  for (const country of supportedCountries) {
    assert.equal(resolveWorkspaceEdition(country, supportedCountries), "global");
  }
});

test("unknown and malformed workspace countries fail closed", () => {
  for (const country of [null, undefined, "", "USA", "ZZ", "1N", 42]) {
    assert.equal(resolveWorkspaceEdition(country, supportedCountries), null);
  }
});

test("legacy build edition resolution remains backward compatible", () => {
  assert.equal(resolveEditionId("india"), "india");
  assert.equal(resolveEditionId("global"), "global");
  assert.equal(resolveEditionId("unified"), "india");
});
