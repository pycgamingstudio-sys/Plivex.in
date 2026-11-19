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
  assert.match(features, /id: "quotations"/);
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
  assert.match(app, /workspaceFeatures\.includes\("stock"\)/);
  assert.match(app, /workspaceFeatures\.includes\("team"\)/);
  assert.match(app, /if \(t\.id === "warehouses"\) return workspaceFeatures\.includes\("inventoryWorkspace"\)/);
  assert.ok(dashboard.indexOf('id: "invoices"') < dashboard.indexOf('id: "quotations"'));
});

test("unified auth keeps one public workspace identity regardless of country", async () => {
  const auth = await read("../../lib/AuthContext.jsx");
  assert.match(auth, /if \(isUnifiedBuild\) \{[\s\S]*setRuntimeEdition\("india"\);[\s\S]*return currentUser;/);
  assert.ok(auth.indexOf("if (isUnifiedBuild)") < auth.indexOf("const shouldResolveGlobal = APP_EDITION === \"global\" || isUnifiedBuild"));
});

test("More Features exposes every dashboard module and supports adding optional tools for freelancers too", async () => {
  const library = await read("../../components/dashboard/FeatureLibraryModal.jsx");
  const dashboard = await read("../../components/dashboard/DashboardTab.jsx");
  const nav = await read("../../pages/Dashboard.jsx");
  const layout = await read("../../components/AppLayout.jsx");
  assert.match(dashboard, /More Features/);
  assert.match(library, /const catalog = getAvailableWorkspaceFeatureCatalog\(APP_EDITION\)/);
  assert.match(library, /catalog\.map\(\(item\) =>/);
  assert.match(library, /Remove from dashboard/);
  assert.match(library, /Always included/);
  assert.match(library, /Stock and Team Members can be added by Freelancer workspaces too/);
  for (const id of ["invoices", "quotations", "expenses", "crm", "leads", "reports", "stock", "team", "inventoryWorkspace"]) assert.ok(library.includes(id) || (await read("../../lib/workspaceFeatures.js")).includes(`id: "${id}"`), "Missing module: " + id);
  assert.match(nav, /workspaceFeatures.includes\("inventoryWorkspace"\)/);
  assert.match(nav, /workspaceFeatures.includes\("reports"\)/);
  assert.match(nav, /workspaceFeatures.includes\("team"\)/);
  for (const label of ["Dashboard", "Sales", "Purchase", "Reports", "Client CRM", "Stock", "Team", "Warehouse"]) assert.ok(layout.includes(`label: "${label}"`), "Missing Global navigation area: " + label);
});

test("feature preference changes do not mutate or delete business records", async () => {
  const helper = await read("../../lib/workspaceFeatures.js");
  const library = await read("../../components/dashboard/FeatureLibraryModal.jsx");
  assert.match(helper, /plivex_workspace_features/);
  assert.match(helper, /plivex:workspace-features-updated/);
  assert.match(helper, /window.dispatchEvent/);
  assert.match(library, /never deletes invoices, customers, expenses, stock or other saved records/);
});

test("optional Workspace modules stay gated when users open direct URLs", async () => {
  const app = await read("../../App.jsx");
  assert.match(app, /function WorkspaceFeatureGate/);
  assert.match(app, /WorkspaceFeatureGate feature="inventoryWorkspace"/);
  assert.match(app, /WorkspaceFeatureGate anyOf=\{\["crm", "leads"\]\}/);
  assert.match(app, /WorkspaceFeatureGate feature="reports"/);
  assert.match(app, /WorkspaceFeatureGate feature="expenses"/);
  assert.match(app, /WorkspaceFeatureGate feature="team"/);
  const dashboard = await read("../../pages/Dashboard.jsx");
  assert.match(dashboard, /path === "\/team-management"\) return user\?\.workspace_type === "business" \|\| workspaceFeatures\.includes\("team"\)/);
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

test("invoice editor and pricing use authenticated canonical workspace country rather than stale profile currency", async () => {
  const home = await read("../../pages/Home.jsx");
  const loaderStart = home.indexOf("const countryCode = String(user?.country_code");
  const loaderEnd = home.indexOf("// Canonical workspace_settings is the only source");
  const loader = home.slice(loaderStart, loaderEnd);
  assert.ok(loaderStart >= 0);
  assert.match(loader, /user\?\.country_code/);
  assert.match(loader, /user\?\.currency_code/);
  assert.match(loader, /resolveInvoiceCurrencyForWorkspace\(countryCode, currencyCode\)/);
  assert.match(loader, /setWorkspaceTaxProfileLoading\(false\)/);
  assert.doesNotMatch(loader, /supabase\.from\("workspace_settings"\)/);
  assert.match(home, /const effectiveWorkspaceTaxProfile = workspaceTaxProfile/);
  assert.match(home, /countryCode=\{user\?\.country_code \|\| workspaceTaxProfile\?\.countryCode \|\| ""\}/);
  assert.match(home, /currencyCode=\{user\?\.currency_code \|\| workspaceTaxProfile\?\.currencyCode \|\| ""\}/);
  assert.match(home, /countryCode=\{user\?\.country_code \|\| workspaceTaxProfile/);
});


test("invoice saving rejects missing or mismatched canonical workspace currency", async () => {
  const stores = await read("../../lib/stores.js");
  assert.match(stores, /Workspace country and base currency could not be verified/);
  assert.match(stores, /currency !== workspaceCurrency/);
  assert.match(stores, /must match the workspace base currency/);
});

test("Lead Tracker modal keeps its save action visible on small screens", async () => {
  const crm = await read("../../components/dashboard/CrmTab.jsx");
  assert.match(crm, /max-h-\[calc\(100dvh-0\.5rem\)\]/);
  assert.match(crm, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(crm, /shrink-0 justify-end gap-2 border-t/);
  assert.match(crm, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
});


test("unified dashboard paywall resolves billing from the canonical public workspace identity", async () => {
  const paywall = await read("../../lib/paywall.jsx");
  assert.match(paywall, /if \(isUnifiedBuild\) \{[\s\S]*user\.country_code[\s\S]*user\.currency_code[\s\S]*resolveWorkspaceBillingContext\(countryCode, currencyCode\)/);
  assert.match(paywall, /A Global membership is not required to display verified regional pricing/);
  const unifiedBranch = paywall.slice(paywall.indexOf("if (isUnifiedBuild)"), paywall.indexOf("if (APP_EDITION === \"global\")"));
  assert.doesNotMatch(unifiedBranch, /global-auth-context/);
  assert.match(paywall, /if \(APP_EDITION === "global"\) \{[\s\S]*global-auth-context/);
});
