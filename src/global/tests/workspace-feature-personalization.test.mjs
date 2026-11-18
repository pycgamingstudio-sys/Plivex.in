import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("new workspace onboarding follows country, business name, regional details, work type and review", async () => {
  const source = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  const steps = ["Country & region", "Your business", "A local welcome", "Your work", "Review"];
  for (const step of steps) assert.ok(source.includes(step), "Missing onboarding step: " + step);
  assert.match(source, /Business or professional name/);
  assert.match(source, /controlled reset or migration/);
  assert.match(source, /Skip mobile number/);
  assert.match(source, /getCountryFlag\(country.code\)/);
  assert.match(source, /businessType: workTypes\[0\]/);
  assert.match(source, /optionalFeatures: features/);
  assert.match(source, /localeCode, phone, taxType, taxNumber, workTypes, features/);
  assert.match(source, /workTypes.length === 0/);
});

test("freelancer and business are mutually exclusive primary workspace profiles", async () => {
  const source = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  const features = await read("../../lib/workspaceFeatures.js");
  assert.match(source, /chooseWorkType\("freelancer"\)/);
  assert.match(source, /chooseWorkType\("business"\)/);
  assert.match(source, /One primary workspace profile: Freelancer OR Business/);
  assert.match(source, /const next = \[type\]/);
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

test("Freelancer and Business profiles receive the right permanent dashboard cards", async () => {
  const helper = await read("../../lib/workspaceFeatures.js");
  const dashboard = await read("../../components/dashboard/DashboardTab.jsx");
  const app = await read("../../pages/Dashboard.jsx");
  assert.match(helper, /getPermanentDashboardFeatures/);
  assert.match(helper, /workspaceType === "freelancer"/);
  assert.match(helper, /\[\.\.\.PERMANENT_DASHBOARD_FEATURES, "stock", "team"\]/);
  assert.match(dashboard, /getPermanentDashboardFeatures\(user\?\.workspace_type\)/);
  assert.match(app, /useWorkspaceFeatures\(user\?\.workspace_id\)/);
  assert.match(app, /workspace_type === "freelancer".*stock.*team/);
  assert.match(app, /if \(t\.id === "warehouses"\) return workspaceFeatures\.includes\("inventoryWorkspace"\)/);
  assert.ok(dashboard.indexOf('id: "invoices"') < dashboard.indexOf('id: "quotations"'));
});

test("unified auth keeps one public workspace identity regardless of country", async () => {
  const auth = await read("../../lib/AuthContext.jsx");
  assert.match(auth, /if \(isUnifiedBuild\) \{[\s\S]*setRuntimeEdition\("india"\);[\s\S]*return currentUser;/);
  assert.ok(auth.indexOf("if (isUnifiedBuild)") < auth.indexOf("const shouldResolveGlobal = APP_EDITION === \"global\" || isUnifiedBuild"));
});

test("More Features lists optional tools and supports adding or removing them", async () => {
  const library = await read("../../components/dashboard/FeatureLibraryModal.jsx");
  const dashboard = await read("../../components/dashboard/DashboardTab.jsx");
  const nav = await read("../../pages/Dashboard.jsx");
  const layout = await read("../../components/AppLayout.jsx");
  assert.match(dashboard, /More Features/);
  assert.match(library, /getAvailableWorkspaceFeatureCatalog\(APP_EDITION\)\.map\(\(item\) =>/);
  assert.match(library, /Remove from dashboard/);
  assert.match(library, /In your workspace/);
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
