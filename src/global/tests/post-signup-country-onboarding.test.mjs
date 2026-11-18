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
  assert.match(onboarding, /phone: phone\.trim\(\) \|\| null/);
  assert.doesNotMatch(onboarding, /supabase\.auth\.updateUser/);
  assert.match(onboarding, /businessType: workTypes\[0\]/);
  assert.match(onboarding, /optionalFeatures: features/);
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
  assert.match(edgeFunction, /requestedCountryValue = typeof body\?\.countryCode === "string" \? body\.countryCode : ""/);
  assert.doesNotMatch(edgeFunction, /metadata\.signup_country_code/);
  assert.match(edgeFunction, /already has a country selection/);
  assert.doesNotMatch(edgeFunction, /requestedCountry.*: "IN"/);
});

test("PLIVEX ONE persists country, currency, work type and optional modules under RLS", async () => {
  const migration = await read("../../../supabase/migrations/20261118121500_plivex_one_workspace_settings.sql");
  const provisioner = await read("../../../supabase/functions/ensure-owner-role/index.ts");
  const backend = await read("../../api/backendClient.js");
  assert.match(migration, /create table if not exists public\.workspace_settings/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /workspace_settings_country_currency_check/);
  assert.match(migration, /Existing accounts must complete the same manual country and work-profile onboarding/);
  assert.doesNotMatch(migration, /from public\.business_profile bp/);
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

test("unified workspace feature links open the matching India-master dashboard modules", async () => {
  const app = await read("../../App.jsx");
  const homeGate = await read("../../components/HomeGate.jsx");
  const dashboard = await read("../../pages/Dashboard.jsx");
  const sales = await read("../../components/dashboard/SalesTab.jsx");
  assert.match(app, /path="\/expenses" element=\{isGlobalWorkspace \? <GlobalApp section="expenses" \/> : <Navigate to="\/dashboard" replace state=\{\{ initialTab: "purchase" \}\} \/>\}/);
  assert.match(app, /path="\/products" element=\{isGlobalWorkspace \? <GlobalApp section="products" \/> : <Navigate to="\/dashboard" replace state=\{\{ initialTab: "stock" \}\} \/>\}/);
  assert.match(app, /path="\/quotations" element=\{isGlobalWorkspace \? <GlobalApp section="quotations" \/> : <Navigate to="\/dashboard" replace state=\{\{ initialTab: "sales", initialSub: "quotations" \}\} \/>\}/);
  assert.match(homeGate, /routeState\.initialTab/);
  assert.match(homeGate, /routeState\.initialSub/);
  assert.match(dashboard, /initialSub=\{initialSub\}/);
  assert.match(sales, /initialSub === "quotations" \? "quotations" : "invoices"/);
});

test("dashboard waits for workspace feature preferences before validating a deep-linked tab", async () => {
  const dashboard = await read("../../pages/Dashboard.jsx");
  assert.match(dashboard, /ready: workspaceFeaturesReady/);
  assert.match(dashboard, /if \(!workspaceFeaturesReady\) return/);
  assert.match(dashboard, /\[visibleTabs, tab, workspaceFeaturesReady\]/);
});

test("monetary workspace records are stamped with the verified canonical currency", async () => {
  const records = await read("../../../supabase/functions/workspace-records/index.ts");
  assert.match(records, /const CURRENCY_TABLES = new Set\(\["expenses", "stock", "services", "leads", "quotations"\]\)/);
  assert.match(records, /from\("workspace_settings"\)[\s\S]*select\("currency_code"\)/);
  assert.match(records, /No currency default is assumed/);
  assert.match(records, /if \(CURRENCY_TABLES\.has\(table\)\) values\.currency_code = workspaceCurrencyCode/);
  const fields = records.slice(records.indexOf("const FIELDS"), records.indexOf("const CURRENCY_TABLES"));
  assert.doesNotMatch(fields, /currency_code/);
});

test("invoice country, currency and non-India draft rules are enforced below the Edge Function", async () => {
  const migration = await read("../../../supabase/migrations/20261118121500_plivex_one_workspace_settings.sql");
  assert.match(migration, /create or replace function public\.enforce_workspace_invoice_currency/);
  assert.match(migration, /invoice_currency_must_match_workspace_base_currency/);
  assert.match(migration, /non_india_invoices_must_remain_drafts_until_issuance_is_verified/);
  assert.match(migration, /india_gst_item_rates_not_allowed_for_non_india_workspace/);
  assert.match(migration, /revoke all on function public\.save_invoice\(jsonb, jsonb, uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.save_invoice\(jsonb, jsonb, uuid\) to authenticated, service_role/);
});

test("additional invoice currencies require verified India Pro entitlement at API and database layers", async () => {
  const saveInvoice = await read("../../../supabase/functions/save-invoice/index.ts");
  const migration = await read("../../../supabase/migrations/20261118121500_plivex_one_workspace_settings.sql");
  assert.match(saveInvoice, /get_access_status/);
  assert.match(saveInvoice, /accessStatus\?\.features\?\.multi_currency !== true/);
  assert.match(migration, /v_access := public\.get_access_status\(new\.workspace_id\)/);
  assert.match(migration, /v_multi_currency := coalesce\(\(v_access->'features'->>'multi_currency'\)::boolean, false\)/);
  assert.match(migration, /if v_country <> 'IN' then[\s\S]*invoice_currency_must_match_workspace_base_currency/);
});
