import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [app, auth, backend, onboarding, worker, vite] = await Promise.all([
  read("../../App.jsx"),
  read("../../lib/AuthContext.jsx"),
  read("../../api/backendClient.js"),
  read("../../components/global/GlobalCountryOnboarding.jsx"),
  read("../../../wrangler.jsonc"),
  read("../../../vite.config.js"),
]);

test("India and Global workspaces mount one shared router and AppLayout", () => {
  assert.match(app, /const GlobalApp = lazy\(\(\) => import\("@\/global\/GlobalApp"\)\)/);
  assert.match(app, /APP_EDITION === "global" && isAuthenticated/);
  assert.doesNotMatch(app, /window\.location\.hostname/);
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /element={<AppLayout \/>}/);
  assert.match(app, /APP_EDITION === "global" && isAuthenticated/);
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
