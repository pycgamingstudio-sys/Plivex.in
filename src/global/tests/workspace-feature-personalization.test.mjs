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

test("optional Workspace modules stay gated when users open direct URLs", async () => {
  const app = await read("../../App.jsx");
  assert.match(app, /function WorkspaceFeatureGate/);
  assert.match(app, /WorkspaceFeatureGate feature="inventoryWorkspace"/);
  assert.match(app, /WorkspaceFeatureGate anyOf=\{\["crm", "leads"\]\}/);
  assert.match(app, /WorkspaceFeatureGate feature="reports"/);
  assert.match(app, /WorkspaceFeatureGate feature="expenses"/);
  assert.match(app, /WorkspaceFeatureGate businessOnly/);
  const dashboard = await read("../../pages/Dashboard.jsx");
  assert.match(dashboard, /path === "\/team-management"\) return user\?\.workspace_type === "business"/);
});


test("workspace feature preferences confirm that a canonical settings row was actually updated", async () => {
  const helper = await read("../../lib/workspaceFeatures.js");
  assert.match(helper, /select\("workspace_id"\)/);
  assert.match(helper, /Workspace settings were not found, so feature changes could not be saved/);
});

test("dashboard card order is persisted and mobile visibility controls expose accessible reorder actions", async () => {
  const dashboard = await read("../../components/dashboard/DashboardTab.jsx");
  assert.match(dashboard, /CARD_ORDER_KEY = "invoicepulse:dashboardCardOrder"/);
  assert.match(dashboard, /useLocalState\(CARD_ORDER_KEY, DEFAULT_CARD_ORDER\)/);
  assert.match(dashboard, /setCardOrder\(\(current\)/);
  assert.match(dashboard, /aria-label=\{\x60Move \$\{c\.title\} up\x60\}/);
  assert.match(dashboard, /aria-label=\{\x60Move \$\{c\.title\} down\x60\}/);
  assert.match(dashboard, /max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(dashboard, /overflow-y-auto bg-black\/40 p-2/);
});


test("expense and lead entry modals receive the active workspace currency explicitly", async () => {
  const expenses = await read("../../components/dashboard/PurchaseTab.jsx");
  const crm = await read("../../components/dashboard/CrmTab.jsx");
  assert.match(expenses, /<ExpenseModal currencyCode=\{currencyCode\}/);
  assert.match(expenses, /function ExpenseModal\(\{ currencyCode, onClose, onSave \}\)/);
  assert.match(crm, /<LeadModal currencyCode=\{currencyCode\}/);
  assert.match(crm, /function LeadModal\(\{ currencyCode, onClose, onSave \}\)/);
  assert.match(crm, /\{ \.\.\.entry, currencyCode, nextFollowUpAt/);
});

test("invoice editor uses canonical workspace_settings currency rather than stale profile currency", async () => {
  const home = await read("../../pages/Home.jsx");
  assert.match(home, /supabase\.from\("workspace_settings"\)/);
  assert.match(home, /select\("country_code,currency_code,locale_code"\)/);
  assert.match(home, /const countryCode = String\(settings\?\.country_code/);
  assert.match(home, /const currencyCode = String\(settings\?\.currency_code/);
  assert.match(home, /workspaceTaxProfile\?\.currencyCode \|\| user\?\.currency_code/);
  assert.doesNotMatch(home, /if \(!user\?\.country_code \|\| !user\?\.currency_code\) return;/);
});
