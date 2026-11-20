import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [backend, authContext, stores, paywall, login, register, app, onboarding, migration] = await Promise.all([
  read("../../api/backendClient.js"),
  read("../../lib/AuthContext.jsx"),
  read("../../lib/stores.js"),
  read("../../lib/paywall.jsx"),
  read("../../pages/Login.jsx"),
  read("../../pages/Register.jsx"),
  read("../../App.jsx"),
  read("../../components/global/UnifiedWorkspaceOnboarding.jsx"),
  read("../../../supabase/migrations/20261118121500_plivex_one_workspace_settings.sql"),
]);

test("retired Global backend adapters remain blocked from unified runtime", () => {
  assert.match(backend, /resolveEditionId\(import\.meta\.env\.VITE_APP_EDITION\)/);
  assert.match(backend, /APP_EDITION === "global" && !\["global-ensure-owner", "global-business-records", "global-invoices", "global-stock-movements", "global-update-workspace-country", "reset-workspace-country"\]\.includes\(functionName\)/);
  assert.match(backend, /global-auth-context/);
  assert.match(backend, /global-update-profile/);
});

test("unified build keeps one public workspace identity and provisions through canonical endpoint", () => {
  assert.match(authContext, /if \(isUnifiedBuild\) \{[\s\S]*setRuntimeEdition\("india"\);[\s\S]*return \{/);
  const unifiedAuth = authContext.slice(authContext.indexOf("if (isUnifiedBuild)"), authContext.indexOf("const existingCountry"));
  assert.doesNotMatch(unifiedAuth, /global-auth-context/);
  assert.match(unifiedAuth, /currentUser\?\.country_code/);
  assert.match(app, /\(!user\.workspace_id \|\| !user\.country_code \|\| !user\.workspace_type \|\| Number\(user\.onboarding_version \|\| 0\) < 1 \|\| user\.migration_status !== "ready" \|\| user\.legacy_review_required\)/);
  assert.match(onboarding, /ensureOwnerRole/);
  assert.doesNotMatch(onboarding, /globalEnsureOwner/);
  assert.match(backend, /workspace_settings/);
});


test("authenticated users cannot self-promote or reassign their workspace through profiles", () => {
  assert.match(migration, /revoke update on table public\.profiles from authenticated/);
  assert.match(migration, /revoke update \([\s\S]*role, workspace_id[\s\S]*\) on public\.profiles from authenticated/);
  assert.match(migration, /grant update \(full_name, profile_picture\) on public\.profiles to authenticated/);
  assert.match(migration, /revoke insert, update on public\.workspace_settings from authenticated/);
  assert.match(migration, /grant update \(optional_features, updated_at\) on public\.workspace_settings to authenticated/);
});

test("legacy isolated storage never imports India localStorage keys", () => {
  assert.match(stores, /if \(options\?\.migrateLegacy !== false\) migrateLegacyData/);
});

test("legacy login and registration keep invite verification edition-gated", () => {
  assert.match(login, /APP_EDITION === "global" && code/);
  assert.match(register, /APP_EDITION === "global" && code/);
});

test("legacy provider-neutral checkout warm-up does not change subscriptions", () => {
  assert.match(paywall, /if \(APP_EDITION === "global"\)/);
  assert.match(paywall, /International subscription checkout is not active yet/);
  assert.match(paywall, /Your plan and workspace have not been changed/);
  const start = paywall.indexOf("const startCheckout");
  const end = paywall.indexOf("const validPhone", start);
  assert.ok(start >= 0 && end > start);
  const checkout = paywall.slice(start, end);
  assert.ok(checkout.indexOf('if (APP_EDITION === "global")') < checkout.indexOf("startCashfreeCheckout"));
});
