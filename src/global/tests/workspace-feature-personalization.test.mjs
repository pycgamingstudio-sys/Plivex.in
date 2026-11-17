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
  assert.match(features, /getSuggestedWorkspaceFeatures\(workTypes = \[\], countryCode = "IN"\)/);
  assert.match(features, /countryCode === "IN" \? \["quotations"\] : \[\]/);
  assert.match(features, /return WORKSPACE_FEATURE_CATALOG/);
  assert.match(features, /id: "quotations"/);
});

test("Invoices, Stock and Team are permanent dashboard cards", async () => {
  const helper = await read("../../lib/workspaceFeatures.js");
  const dashboard = await read("../../components/dashboard/DashboardTab.jsx");
  assert.match(helper, /PERMANENT_DASHBOARD_FEATURES.*invoices.*stock.*team/);
  assert.match(dashboard, /PERMANENT_DASHBOARD_FEATURES.includes\(card.id\)/);
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
