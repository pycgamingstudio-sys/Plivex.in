import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("new workspace onboarding follows business, country, regional welcome, work type and review", async () => {
  const source = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  const steps = ["Your business", "Country & region", "A local welcome", "Your work", "Review"];
  for (const step of steps) assert.ok(source.includes(step), "Missing onboarding step: " + step);
  assert.match(source, /Business or workspace name/);
  assert.match(source, /controlled reset or migration/);
  assert.match(source, /Skip mobile number/);
  assert.match(source, /getCountryFlag\(country.code\)/);
  assert.match(source, /plivex_work_types: workTypes/);
  assert.match(source, /plivex_workspace_features: features/);
  assert.match(source, /localeCode, phone, taxType, taxNumber, workTypes, features/);
  assert.match(source, /workTypes.length === 0/);
});

test("freelancer and business can be selected independently or together", async () => {
  const source = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  const features = await read("../../lib/workspaceFeatures.js");
  assert.match(source, /chooseWorkType\("freelancer"\)/);
  assert.match(source, /chooseWorkType\("business"\)/);
  assert.match(source, /You can select one or both/);
  assert.match(features, /getSuggestedWorkspaceFeatures/);
  assert.match(features, /inventoryWorkspace/);
  assert.match(features, /getSuggestedWorkspaceFeatures\(workTypes = \[\]\)/);
  assert.match(features, /return WORKSPACE_FEATURE_CATALOG/);
  assert.doesNotMatch(features, /id: "quotations"/);
  const layout = await read("../../components/AppLayout.jsx");
  const globalApp = await read("../../global/GlobalApp.jsx");
  assert.match(layout, /if \(item\.to === "\/quotations"\) return true/);
  assert.match(globalApp, /tab === "quotations"/);
  assert.match(globalApp, /title: "Quotations"[\s\S]*tab: "quotations"[\s\S]*icon: FileText/);
  assert.doesNotMatch(globalApp, /tab: "quotations", icon: FileText, tone:.*feature catalog/);
});

test("Invoices, Quotations, Stock and Team are permanent dashboard cards", async () => {
  const helper = await read("../../lib/workspaceFeatures.js");
  const dashboard = await read("../../components/dashboard/DashboardTab.jsx");
  assert.match(helper, /PERMANENT_DASHBOARD_FEATURES.*invoices.*quotations.*stock.*team/);
  assert.ok(dashboard.includes("PERMANENT_DASHBOARD_FEATURES.includes(card.id)"));
  assert.match(dashboard, /id: "invoices"[\\s\\S]*id: "quotations"[\\s\\S]*id: "expenses"/);
});

test("unified auth checks authoritative Global membership even when legacy India profile says IN", async () => {
  const auth = await read("../../lib/AuthContext.jsx");
  assert.ok(auth.includes("APP_EDITION === \"global\" || isUnifiedBuild || countryCode !== 'IN'"));
  assert.ok(auth.includes("globalUser = globalContext.user"));
  assert.ok(auth.includes("countryCode = globalUser.country_code || countryCode"));
  assert.ok(auth.includes("APP_EDITION === \"global\" || (countryCode && countryCode !== 'IN')"));
});

test("More Features only offers optional tools not already in navigation", async () => {
  const library = await read("../../components/dashboard/FeatureLibraryModal.jsx");
  const dashboard = await read("../../components/dashboard/DashboardTab.jsx");
  const nav = await read("../../pages/Dashboard.jsx");
  const layout = await read("../../components/AppLayout.jsx");
  assert.match(dashboard, /More Features/);
  assert.match(library, /getAvailableWorkspaceFeatureCatalog\(APP_EDITION\)\.filter\(\(item\) => !features\.includes\(item\.id\)\)/);
  assert.match(nav, /workspaceFeatures.includes\("inventoryWorkspace"\)/);
  assert.match(nav, /workspaceFeatures.includes\("reports"\)/);
  for (const label of ["Dashboard", "Sales", "Purchase", "Reports", "Client CRM", "Stock", "Team", "Warehouse"]) assert.ok(layout.includes(`label: "${label}"`), "Missing Global navigation area: " + label);
});

test("feature preference changes do not mutate or delete business records", async () => {
  const helper = await read("../../lib/workspaceFeatures.js");
  const library = await read("../../components/dashboard/FeatureLibraryModal.jsx");
  assert.match(helper, /plivex_workspace_features/);
  assert.match(helper, /plivex:workspace-features-updated/);
  assert.match(helper, /window.dispatchEvent/);
  assert.match(library, /never delete business records/);
});
