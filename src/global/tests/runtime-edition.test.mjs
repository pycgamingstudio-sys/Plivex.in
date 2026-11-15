import test from "node:test";
import assert from "node:assert/strict";
import { resolveRuntimeEdition } from "../core/runtime-edition.js";

test("separate India and Global builds remain pinned to their editions", () => {
  assert.equal(resolveRuntimeEdition({ buildEdition: "india", countryCode: "US" }), "india");
  assert.equal(resolveRuntimeEdition({ buildEdition: "global", countryCode: "IN" }), "global");
});

test("unified explicit runtime mode takes precedence over legacy schema rows", () => {
  assert.equal(resolveRuntimeEdition({ buildEdition: "unified", mode: "global", hasLegacyProfile: true }), "global");
  assert.equal(resolveRuntimeEdition({ buildEdition: "unified", mode: "india" }), "india");
  assert.equal(resolveRuntimeEdition({ buildEdition: "unified", mode: "pending", hasLegacyProfile: true }), "pending");
});

test("Global membership is checked before legacy India profile fallback", () => {
  assert.equal(resolveRuntimeEdition({ buildEdition: "unified", hasGlobalWorkspace: true, hasLegacyProfile: true }), "global");
  assert.equal(resolveRuntimeEdition({ buildEdition: "unified", hasLegacyProfile: true, countryCode: "US" }), "india");
});

test("new OAuth identities pause for country choice before app routing", () => {
  assert.equal(resolveRuntimeEdition({ buildEdition: "unified", hasLegacyProfile: true, firstGoogleSignup: true }), "pending");
  assert.equal(resolveRuntimeEdition({ buildEdition: "unified" }), "pending");
  assert.equal(resolveRuntimeEdition({ buildEdition: "unified", countryCode: "US" }), "global");
});
