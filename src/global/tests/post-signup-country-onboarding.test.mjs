import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("unified signup authenticates first and collects country after sign-in", async () => {
  const register = await read("../../pages/Register.jsx");
  const google = await read("../../components/auth/GoogleSignInButton.jsx");
  const backend = await read("../../api/backendClient.js");
  const onboarding = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  assert.match(register, /db\.auth\.register\(\{ email, password \}\)/);
  assert.doesNotMatch(register, /signup-country|Business country/);
  assert.match(google, /countryCode = ""/);
  assert.match(google, /APP_EDITION !== "global" && countryCode/);
  assert.match(backend, /signupMetadata/);
  assert.match(onboarding, /Create my workspace/);
  assert.doesNotMatch(onboarding, /globalEnsureOwner/);
  assert.match(onboarding, /ensureOwnerRole/);
  assert.match(onboarding, /businessType: workTypes\[0\]/);
  assert.match(onboarding, /optionalFeatures: features/);
  assert.match(onboarding, /plivex_work_types: workTypes/);
  assert.match(onboarding, /plivex_workspace_features: features/);
});

test("new unified identities are held at onboarding before workspace provisioning", async () => {
  const auth = await read("../../lib/AuthContext.jsx");
  const app = await read("../../App.jsx");
  const onboarding = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  assert.match(auth, /Unified signup is authenticated first/);
  assert.match(auth, /setIsAuthenticated\(true\)/);
  assert.match(app, /UnifiedWorkspaceOnboarding/);
  assert.match(onboarding, /Choose your country/);
  assert.match(onboarding, /controlled reset or migration/);
  assert.match(onboarding, /Create my workspace/);
});

test("unified runtime does not resolve a second Global workspace identity", async () => {
  const auth = await read("../../lib/AuthContext.jsx");
  const app = await read("../../App.jsx");
  assert.match(auth, /if \(isUnifiedBuild\) \{[\s\S]*setRuntimeEdition\("india"\);[\s\S]*return currentUser;/);
  assert.match(app, /\(!user\.workspace_id \|\| !user\.country_code \|\| !user\.workspace_type\)/);
});

test("Global owner provisioning rejects a missing country instead of defaulting to India", async () => {
  const edgeFunction = await read("../../../supabase/functions/ensure-owner-role/index.ts");
  assert.match(edgeFunction, /Choose a supported business country before creating your workspace/);
  assert.match(edgeFunction, /Choose a valid regional format for your selected country/);
  assert.doesNotMatch(edgeFunction, /requestedCountry.*: "IN"/);
});

test("PLIVEX ONE persists country, currency, work type and optional modules under RLS", async () => {
  const migration = await read("../../../supabase/migrations/20261118121500_plivex_one_workspace_settings.sql");
  const provisioner = await read("../../../supabase/functions/ensure-owner-role/index.ts");
  const backend = await read("../../api/backendClient.js");
  assert.match(migration, /create table if not exists public\.workspace_settings/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /workspace_settings_country_currency_check/);
  assert.match(migration, /Never infer India from missing data/);
  assert.match(provisioner, /currency_code: currencyByCountry\[countryCode\]/);
  assert.match(provisioner, /workspace_type: workspaceType/);
  assert.match(provisioner, /optional_features: optionalFeatures/);
  assert.match(backend, /currency_code: workspaceSettings\?\.currency_code/);
});

test("invoice persistence reads country and currency only from canonical workspace settings", async () => {
  const saveInvoice = await read("../../../supabase/functions/save-invoice/index.ts");
  assert.match(saveInvoice, /db\.from\("workspace_settings"\)\.select\("country_code,currency_code,locale_code"\)/);
  assert.match(saveInvoice, /const countryCode = String\(workspaceSettings\?\.country_code \|\| ""\)/);
  assert.match(saveInvoice, /const baseCurrencyCode = String\(workspaceSettings\?\.currency_code \|\| ""\)/);
  assert.match(saveInvoice, /No country or currency default is assumed/);
  assert.match(saveInvoice, /requestedCurrency !== baseCurrencyCode/);
  assert.doesNotMatch(saveInvoice, /businessProfile\?\.country_code \|\| "IN"/);
});

test("onboarding lets users choose optional modules instead of only accepting automatic suggestions", async () => {
  const onboarding = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  const featureCatalog = await read("../../lib/workspaceFeatures.js");
  assert.match(onboarding, /WORKSPACE_FEATURE_CATALOG\.map\(\(feature\)/);
  assert.match(onboarding, /type="checkbox" checked=\{features\.includes\(feature\.id\)\}/);
  assert.match(onboarding, /const toggleFeature = \(featureId\)/);
  assert.match(onboarding, /setFeatures\(\(current\) => current\.includes\(featureId\)/);
  assert.match(onboarding, /You can change these later in More Features/);
  assert.match(featureCatalog, /export const WORKSPACE_FEATURE_CATALOG/);
});
