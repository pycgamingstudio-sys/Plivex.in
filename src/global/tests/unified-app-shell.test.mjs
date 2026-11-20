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

test("all countries in the unified build stay on the canonical Main Workspace routes", () => {
  const app = read("../../App.jsx");
  const backend = read("../../api/backendClient.js");
  const homeGate = read("../../components/HomeGate.jsx");
  const auth = read("../../lib/AuthContext.jsx");
  assert.match(app, /const isGlobalWorkspace = !isUnifiedBuild && APP_EDITION === "global"/);
  assert.match(homeGate, /const isGlobalWorkspace = !isUnifiedBuild && APP_EDITION === "global"/);
  assert.match(auth, /if \(isUnifiedBuild\) \{[\s\S]*setRuntimeEdition\("india"\)/);
  assert.match(backend, /if \(isUnifiedBuild && edition === "global"\) return false/);
  assert.ok(app.includes('<Route path="/invoice-history" element={isGlobalWorkspace ? <GlobalApp section="invoices" /> : <InvoiceHistory />} />'));
  assert.doesNotMatch(app, /isUnifiedBuild && Boolean\(user\?\.country_code && user\.country_code !== "IN"\)/);
  assert.match(app, /Workspace country/);
  assert.doesNotMatch(app, />Global workspace</);
});
test("unified authentication never resolves or activates a Global workspace", () => {
  const auth = read("../../lib/AuthContext.jsx");
  const backend = read("../../api/backendClient.js");
  const unifiedResolver = auth.slice(auth.indexOf("async function resolveSignedInEdition"), auth.indexOf("const existingCountry"));
  assert.match(unifiedResolver, /if \(isUnifiedBuild\)/);
  assert.doesNotMatch(unifiedResolver, /global-auth-context/);
  assert.match(unifiedResolver, /setRuntimeEdition\("india"\)/);
  assert.match(unifiedResolver, /currentUser\?\.country_code/);
  assert.match(backend, /if \(isUnifiedBuild && edition === "global"\) return false/);
  assert.match(auth, /const shouldResolveGlobal = APP_EDITION === "global" \|\| isUnifiedBuild \|\| countryCode !== 'IN'/);
  const legacyResolver = auth.slice(auth.indexOf("const existingCountry"), auth.indexOf("export const AuthProvider"));
  assert.match(legacyResolver, /globalUser\.workspace_id/);
  assert.match(auth, /setRuntimeEdition\("global", \{ verifiedGlobal: true \}\)/);
  assert.match(auth, /const wasGlobalWorkspace = APP_EDITION === 'global'/);
  assert.match(auth, /migrateLegacy: !wasGlobalWorkspace/);
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
