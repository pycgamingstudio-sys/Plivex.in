import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Global workspace shell is not loaded through a route-time dynamic chunk", () => {
  const app = read("../../App.jsx");
  assert.ok(app.includes('import GlobalApp from "@/global/GlobalApp";'));
  assert.doesNotMatch(app, /const GlobalApp = lazy/);
});

test("payment callback routing preserves unconditional hook order", () => {
  const app = read("../../App.jsx");
  const component = app.slice(app.indexOf("const AuthenticatedApp ="), app.indexOf("// Shows a message"));
  assert.ok(component.indexOf("const { isLoadingAuth") < component.indexOf('if (window.location.pathname === "/payment-result")'));
});

test("India and Global experiences share the same Plivex application shell and navigation", () => {
  const app = read("../../App.jsx");
  const backend = read("../../api/backendClient.js");
  const layout = read("../../components/AppLayout.jsx");
  const global = read("../../global/GlobalApp.jsx");
  assert.doesNotMatch(app, /return <AppLayout><GlobalApp \/><\/AppLayout>/);
  assert.match(app, /<AuthProvider>/);
  assert.ok(app.includes('<Route path="/dashboard" element={<HomeGate />} />'));
  const homeGate = read("../../components/HomeGate.jsx");
  assert.ok(homeGate.includes("<TrialGate><AppLayout><GlobalApp section=\"overview\" /></AppLayout></TrialGate>"));
  assert.ok(app.includes('<Route path="/invoice-history" element={isGlobalWorkspace ? <GlobalApp section="invoices" /> : <InvoiceHistory />} />'));
  assert.match(layout, /GLOBAL_NAV/);
  assert.match(layout, /Global Workspace/);
  assert.ok(layout.includes('<NavLink key={item.to} to={item.to}'));
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
  assert.ok(auth.includes('setRuntimeEdition(edition, { verifiedGlobal: edition === "global" && Boolean(globalUser) });'));
  const unifiedResolver = auth.slice(auth.indexOf("async function resolveSignedInEdition"), auth.indexOf("export const AuthProvider"));
  assert.match(unifiedResolver, /if \(isUnifiedBuild\)[\s\S]*?global-auth-context/);
  assert.match(unifiedResolver, /globalUser\.workspace_id/);
  assert.match(unifiedResolver, /setRuntimeEdition\("global", \{ verifiedGlobal: true \}\)/);
  assert.match(unifiedResolver, /globalUser\.id !== currentUser\?\.id/);
  assert.match(unifiedResolver, /profileCountry === "IN"/);
  assert.match(unifiedResolver, /Always resolve the server-owned Global membership/);
  assert.ok(unifiedResolver.indexOf('supabase.functions.invoke("global-auth-context"') < unifiedResolver.indexOf('profileCountry === "IN"'));
  assert.doesNotMatch(unifiedResolver, /if \(!countryCode \|\| countryCode === "IN"\)/);
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
  assert.match(backend, /workspaceSettings\?\.country_code/);
  assert.doesNotMatch(backend, /workspaceRegion\?\.country_code|profile\?\.country_code/);
  assert.match(auth, /resolveWorkspaceEdition\(countryCode, supportedCodes\)/);
  assert.match(paywall, /base_currency: true/);
  assert.match(paywall, /feature === "base_currency"/);
  assert.match(paywall, /multi_currency: false/);
  assert.match(onboarding, /Workspace base currency/);
});

test("Android stock product form keeps Save and Cancel visible while fields scroll", () => {
  const stock = read("../../components/dashboard/StockTab.jsx");
  assert.match(stock, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(stock, /flex-1 overflow-y-auto overscroll-contain/);
  assert.match(stock, /sticky bottom-0/);
  assert.match(stock, /safe-area-inset-bottom/);
});

test("shared CRM, warehouse, transfers and procurement are gated by Workspace preferences", () => {
  const app = read("../../App.jsx");
  const nav = read("../../lib/nav.js");
  assert.match(app, /WorkspaceFeatureGate anyOf=\{\["crm", "leads"\]\}/);
  assert.match(app, /WorkspaceFeatureGate feature="inventoryWorkspace"/);
  assert.match(nav, /label: "CRM & leads"/);
  assert.match(nav, /label: "Inventory & procurement"/);
});
