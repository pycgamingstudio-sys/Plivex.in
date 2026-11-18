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
  assert.match(backend, /APP_EDITION === "global" && !\["global-ensure-owner", "global-business-records", "global-invoices", "global-stock-movements", "global-update-workspace-country", "reset-workspace-country"\]\.includes\(functionName\)/);
  assert.match(backend, /global-auth-context/);
  assert.match(backend, /global-update-profile/);
});

test("Global auth hydrates workspace data only through the isolated Global adapter", () => {
  assert.match(authContext, /APP_EDITION === "global"/);
  assert.ok(authContext.includes('if (!isUnifiedBuild && APP_EDITION !== "global" && (!existingCountry || existingCountry === "IN")) return currentUser;'));
  assert.ok(authContext.includes("const shouldResolveGlobal = APP_EDITION === \"global\" || isUnifiedBuild || countryCode !== 'IN'"));
  assert.ok(authContext.includes('currentUser?.country_code && String(currentUser.country_code).trim().toUpperCase() !== "IN"'));
  assert.ok(authContext.includes('setRuntimeEdition(edition, { verifiedGlobal: edition === "global" && Boolean(globalUser) });'));
  assert.ok(backend.includes('if (!isUnifiedBuild && edition === "global" && !verifiedGlobal) return false;'));
  assert.doesNotMatch(authContext, /globalEnsureOwner/);
  assert.match(app, /GlobalCountryOnboarding/);
  assert.match(onboarding, /globalEnsureOwner/);
  assert.match(authContext, /global:\$\{currentUser\.id\}/);
  assert.match(authContext, /Global workspace invitations are not available yet/);
  const globalStart = authContext.indexOf('if (APP_EDITION === "global")');
  const indiaStart = authContext.indexOf("setTenantId(currentUser?.id)", globalStart);
  const globalBranch = authContext.slice(globalStart, indiaStart);
  assert.match(globalBranch, /if \(currentUser\?\.workspace_id\) await hydrateWorkspaceData\(\)/);
});

test("Global tenant storage never imports legacy India localStorage keys", () => {
  assert.match(stores, /if \(options\?\.migrateLegacy !== false\) migrateLegacyData/);
});

test("Global login and registration do not call India invite verification", () => {
  assert.match(login, /APP_EDITION === "global" && code/);
  assert.match(register, /APP_EDITION === "global" && code/);
});

test("Global paywall uses provider-neutral checkout warm-up without changing subscriptions", () => {
  assert.match(paywall, /if \(APP_EDITION === "global"\)/);
  assert.match(paywall, /International subscription checkout is not active yet/);
  assert.match(paywall, /Your plan and workspace have not been changed/);
  const start = paywall.indexOf("const startCheckout");
  const end = paywall.indexOf("const validPhone", start);
  assert.ok(start >= 0 && end > start);
  const checkout = paywall.slice(start, end);
  assert.ok(checkout.indexOf('if (APP_EDITION === "global")') < checkout.indexOf("startCashfreeCheckout"));
});
