import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [app, auth, backend, onboarding, worker, vite, layout, globalApp] = await Promise.all([
  read("../../App.jsx"),
  read("../../lib/AuthContext.jsx"),
  read("../../api/backendClient.js"),
  read("../../components/global/GlobalCountryOnboarding.jsx"),
  read("../../../wrangler.jsonc"),
  read("../../../vite.config.js"),
  read("../../components/AppLayout.jsx"),
  read("../GlobalApp.jsx"),
]);

test("India and Global use the same origin, authentication provider and responsive workspace shell", () => {
  assert.match(app, /lazy\(\(\) => import\("@\/global\/GlobalApp"\)\)/);
  assert.match(app, /APP_EDITION === "global" && isAuthenticated/);
  assert.match(app, /return <AppLayout><GlobalApp \/><\/AppLayout>/);
  assert.match(app, /isUnifiedBuild/);
  assert.doesNotMatch(app, /window\.location\.hostname/);
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /element={<AppLayout \/>}/);
  assert.match(layout, /Global Workspace/);
  assert.match(layout, /GLOBAL_NAV/);
  assert.match(globalApp, /useSearchParams/);
  assert.doesNotMatch(globalApp, /<header className="border-b border-slate-200 bg-white">/);
  assert.doesNotMatch(globalApp, /<nav className="flex flex-wrap gap-2">/);
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
