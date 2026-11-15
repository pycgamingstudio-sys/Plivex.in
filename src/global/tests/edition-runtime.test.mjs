import test from "node:test";
import assert from "node:assert/strict";
import { resolveEditionId, resolveRuntimeEdition } from "../edition-contract.js";

test("legacy explicit edition builds keep their previous behavior", () => {
  assert.equal(resolveRuntimeEdition("india", "/global/"), "india");
  assert.equal(resolveRuntimeEdition("global", "/"), "global");
  assert.equal(resolveEditionId("unknown"), "india");
});

test("unified build selects Global only on the /global route", () => {
  assert.equal(resolveRuntimeEdition("unified", "/"), "india");
  assert.equal(resolveRuntimeEdition("unified", "/dashboard"), "india");
  assert.equal(resolveRuntimeEdition("unified", "/global"), "global");
  assert.equal(resolveRuntimeEdition("unified", "/global/"), "global");
  assert.equal(resolveRuntimeEdition("unified", "/global/login"), "global");
  assert.equal(resolveRuntimeEdition("unified", "/globality"), "india");
});
