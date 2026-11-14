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

test("Global backend defaults fail closed and blocks India endpoint fallback", () => {
  assert.match(backend, /resolveEditionId\(import\.meta\.env\.VITE_APP_EDITION\)/);
  assert.match(backend, /APP_EDITION === "global" && !\["global-ensure-owner", "global-business-records"\]\.includes\(functionName\)/);
  assert.match(backend, /global-auth-context/);
  assert.match(backend, /global-update-profile/);
});

test("Global auth uses Global RPCs and never hydrates India workspace records", () => {
  assert.match(authContext, /APP_EDITION === "global"/);
  assert.doesNotMatch(authContext, /globalEnsureOwner/);
  assert.match(app, /GlobalCountryOnboarding/);
  assert.match(onboarding, /globalEnsureOwner/);
  assert.match(authContext, /global:\$\{currentUser\.id\}/);
  assert.match(authContext, /Global workspace invitations are not available yet/);
  const globalStart = authContext.indexOf('if (APP_EDITION === "global")');
  const indiaStart = authContext.indexOf("setTenantId(currentUser?.id)", globalStart);
  const globalBranch = authContext.slice(globalStart, indiaStart);
  assert.doesNotMatch(globalBranch, /hydrateWorkspaceData\(\)/);
});

test("Global tenant storage never imports legacy India localStorage keys", () => {
  assert.match(stores, /if \(options\?\.migrateLegacy !== false\) migrateLegacyData/);
});

test("Global login and registration do not call India invite verification", () => {
  assert.match(login, /APP_EDITION === "global" && code/);
  assert.match(register, /APP_EDITION === "global" && code/);
});

test("Global paywall does not read India profiles or enable Cashfree", () => {
  assert.match(paywall, /if \(APP_EDITION === "global"\)/);
  assert.match(paywall, /Payments are not enabled in Plivex Global yet/);
});
