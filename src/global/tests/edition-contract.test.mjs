import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EDITION_ID,
  EDITION_IDS,
  isSupportedEditionId,
  resolveEditionId,
} from "../core/edition-contract.js";

test("India is the safe default", () => {
  assert.equal(DEFAULT_EDITION_ID, "india");
  assert.equal(resolveEditionId(undefined), "india");
  assert.equal(resolveEditionId(null), "india");
  assert.equal(resolveEditionId(""), "india");
});

test("only explicitly supported identifiers resolve", () => {
  assert.equal(resolveEditionId("global"), "global");
  assert.equal(resolveEditionId("india"), "india");
  assert.equal(resolveEditionId(" GLOBAL "), "global");
  assert.equal(resolveEditionId("unknown"), "india");
  assert.equal(resolveEditionId("global;admin"), "india");
  assert.equal(resolveEditionId(1), "india");
  assert.equal(resolveEditionId({ edition: "global" }), "india");
});

test("support check is exact and does not normalize untrusted input", () => {
  assert.equal(isSupportedEditionId(EDITION_IDS.INDIA), true);
  assert.equal(isSupportedEditionId(EDITION_IDS.GLOBAL), true);
  assert.equal(isSupportedEditionId(" GLOBAL "), false);
  assert.equal(isSupportedEditionId("unknown"), false);
  assert.equal(isSupportedEditionId(null), false);
});

test("edition identifiers are immutable", () => {
  assert.equal(Object.isFrozen(EDITION_IDS), true);
  assert.deepEqual(Object.values(EDITION_IDS).sort(), ["global", "india"]);
});
