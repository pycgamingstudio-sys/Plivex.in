import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [app, auth, backend, onboarding, worker, vite, layout, globalApp, roleGuard] = await Promise.all([
  read("../../App.jsx"),
  read("../../lib/AuthContext.jsx"),
  read("../../api/backendClient.js"),
  read("../../components/global/GlobalCountryOnboarding.jsx"),
  read("../../../wrangler.jsonc"),
  read("../../../vite.config.js"),
  read("../../components/AppLayout.jsx"),
  read("../GlobalApp.jsx"),
  read("../../components/RoleGuard.jsx"),
]);

test("India and Global use the same origin, authentication provider and responsive workspace shell", () => {
  assert.match(app, /lazy\(\(\) => import\("@\/global\/GlobalApp"\)\)/);
  assert.match(app, /const isGlobalWorkspace = APP_EDITION === "global"/);
  assert.ok(app.includes('<Route path="/dashboard" element={isGlobalWorkspace && isAuthenticated ? <AppLayout><GlobalApp section="overview" /></AppLayout> : <HomeGate />} />'));
  assert.ok(app.includes('<Route path="/invoice-history" element={isGlobalWorkspace ? <GlobalApp section="invoices" /> : <InvoiceHistory />} />'));
  assert.match(app, /isUnifiedBuild/);
  assert.doesNotMatch(app, /window\.location\.hostname/);
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /element={<AppLayout \/>}/);
  assert.match(layout, /Global Workspace/);
  assert.match(layout, /GLOBAL_NAV/);
  assert.ok(layout.includes('<NavLink key={item.to} to={item.to}'));
  assert.doesNotMatch(layout, /useSearchParams|setSearchParams/);
  assert.doesNotMatch(globalApp, /useSearchParams|setSearchParams/);
  assert.match(roleGuard, /APP_EDITION === "global"/);
  assert.match(roleGuard, /Global role checks are enforced by workspace-scoped Edge Functions and RLS/);
});

test("shared authentication resolves Global workspace membership without reading India profiles for Global", () => {
  assert.match(auth, /resolveSignedInEdition\(currentUser\)/);
  assert.match(auth, /global-auth-context/);
  assert.ok(auth.includes("global:"));
  assert.match(backend, /global-business-records/);
  assert.match(backend, /global-ensure-owner/);
  assert.match(onboarding, /globalEnsureOwner/);
});

test("Global signup cannot accidentally provision an India workspace through Global onboarding", () => {
  assert.match(onboarding, /country\.code === "IN"/);
  assert.match(onboarding, /entry\.code !== "IN"/);
  assert.match(auth, /signup_country_code/);
});

test("unified build uses the existing Plivex Worker config rather than a second Global Worker", () => {
  const config = JSON.parse(worker);
  assert.equal(config.name, "plivex-in");
  assert.match(vite, /edition === 'global' \? '\.\/wrangler\.global\.jsonc' : '\.\/wrangler\.jsonc'/);
  assert.match(vite, /VITE_APP_EDITION: edition/);
});
