import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [backend, authContext, stores, paywall, login, register, app, onboarding] = await Promise.all([
  read("../../api/backendClient.js"),
  read("../../lib/AuthContext.jsx"),
  read("../../lib/stores.js"),
  read("../../lib/paywall.jsx"),
  read("../../pages/Login.jsx"),
  read("../../pages/Register.jsx"),
  read("../../App.jsx"),
  read("../../components/global/GlobalCountryOnboarding.jsx"),
]);

test("Global backend blocks India endpoint fallback in both Global and unified runtime", () => {
  assert.match(backend, /resolveEditionId\(import\.meta\.env\.VITE_APP_EDITION\)/);
  assert.match(backend, /globalRuntime.*global-ensure-owner/);
  assert.match(backend, /resolveRuntimeEdition/);
  assert.match(backend, /global-auth-context/);
  assert.match(backend, /global-update-profile/);
});

test("Global auth uses Global tenant storage and skips India hydration in unified mode", () => {
  assert.match(authContext, /currentUser\?\.edition === "global"/);
  assert.match(authContext, /global:\$\{currentUser\.id\}/);
  assert.match(authContext, /APP_EDITION === "global" && currentUser\?\.workspace_id/);
  assert.match(authContext, /Global workspace invitations are not available yet/);
  assert.match(app, /GlobalCountryOnboarding/);
  assert.match(app, /UnifiedCountryOnboarding/);
  assert.match(onboarding, /globalEnsureOwner/);
});

test("Global tenant storage never imports legacy India localStorage keys", () => {
  assert.match(stores, /if \(options\?\.migrateLegacy !== false\) migrateLegacyData/);
});

test("India invite flows remain available while Global invitations stay disabled", () => {
  assert.match(login, /APP_EDITION === "global" && code/);
  assert.match(register, /APP_EDITION === "global" && code/);
});

test("Global paywall does not read India profiles or enable Cashfree", () => {
  assert.match(paywall, /if \(APP_EDITION === "global"\)/);
  assert.match(paywall, /Payments are not enabled in Plivex Global yet/);
});
