import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("India and Global experiences share the same Plivex application shell and navigation", () => {
  const app = read("../../App.jsx");
  const backend = read("../../api/backendClient.js");
  const layout = read("../../components/AppLayout.jsx");
  const global = read("../../global/GlobalApp.jsx");
  assert.doesNotMatch(app, /return <AppLayout><GlobalApp \/><\/AppLayout>/);
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /<Route path="\\/dashboard" element=\\{isGlobalWorkspace && isAuthenticated \\? <AppLayout><GlobalApp section="overview" \/><\\/AppLayout> : <HomeGate \/>\\}/);
  assert.match(app, /<Route path="\\/invoice-history" element=\\{isGlobalWorkspace \\? <GlobalApp section="invoices" \/> : <InvoiceHistory \/>\\}/);
  assert.match(layout, /GLOBAL_NAV/);
  assert.match(layout, /Global Workspace/);
  assert.match(layout, /<NavLink key=\\{item.to\\} to=\\{item.to\\}/);
  assert.doesNotMatch(layout, /useSearchParams|setSearchParams/);
  assert.doesNotMatch(global, /useSearchParams|setSearchParams/);
  assert.match(backend, /UNIFIED_EDITION_ID/);
  assert.doesNotMatch(app, /window\.location\.hostname/);
});

test("unified authentication resolves workspace country before selecting regional handlers", () => {
  const auth = read("../../lib/AuthContext.jsx");
  const backend = read("../../api/backendClient.js");
  assert.match(auth, /resolveSignedInEdition\(currentUser\)/);
  assert.match(auth, /resolveWorkspaceEdition\(countryCode, supportedCodes\)/);
  assert.match(auth, /setRuntimeEdition\(edition\)/);
  assert.match(auth, /const wasGlobalWorkspace = APP_EDITION === 'global'/);
  assert.match(auth, /migrateLegacy: !wasGlobalWorkspace/);
  assert.match(backend, /export let APP_EDITION/);
  assert.match(backend, /export const isUnifiedBuild/);
});

test("Global country onboarding uses the shared Plivex brand", () => {
  const onboarding = read("../../components/global/GlobalCountryOnboarding.jsx");
  assert.match(onboarding, /<p className="text-sm font-semibold text-primary">Plivex<\/p>/);
  assert.doesNotMatch(onboarding, />Plivex Global</);
  assert.match(onboarding, /filter\(\(entry\) => entry.code !== "IN"\)/);
});

test("single-domain edition follows the active workspace country and base currency stays free", async () => {
  const backend = read("../../api/backendClient.js");
  const auth = read("../../lib/AuthContext.jsx");
  const paywall = read("../../lib/paywall.jsx");
  const onboarding = read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  assert.match(backend, /workspaceRegion\?\.country_code/);
  assert.match(auth, /resolveWorkspaceEdition\(countryCode, supportedCodes\)/);
  assert.match(paywall, /base_currency: true/);
  assert.match(paywall, /feature === "base_currency"/);
  assert.match(paywall, /multi_currency: false/);
  assert.match(onboarding, /Your workspace base currency will be/);
});

test("Android stock product form keeps Save and Cancel visible while fields scroll", () => {
  const stock = read("../../components/dashboard/StockTab.jsx");
  assert.match(stock, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(stock, /flex-1 overflow-y-auto overscroll-contain/);
  assert.match(stock, /sticky bottom-0/);
  assert.match(stock, /safe-area-inset-bottom/);
});

test("shared CRM, warehouse, transfers and procurement remain accessible in India", () => {
  const app = read("../../App.jsx");
  const nav = read("../../lib/nav.js");
  assert.match(app, /path="\/crm" element={<CrmTab \/>}/);
  assert.match(app, /path="\/inventory-procurement" element={<IndiaPart4Tab user={user} \/>}/);
  assert.match(nav, /label: "CRM & leads"/);
  assert.match(nav, /label: "Inventory & procurement"/);
});
