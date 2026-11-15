import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [app, globalApp, onboarding, worker, vite, googleButton, indiaWorker] = await Promise.all([
  read("../../App.jsx"),
  read("../GlobalApp.jsx"),
  read("../../components/global/GlobalCountryOnboarding.jsx"),
  read("../../../wrangler.global.jsonc"),
  read("../../../vite.config.js"),
  read("../../components/auth/GoogleSignInButton.jsx"),
  read("../../../wrangler.jsonc"),
]);

test("Global edition mounts its isolated app before the India providers and route tree", () => {
  assert.ok(app.includes('import GlobalApp from "@/global/GlobalApp.jsx";'));
  assert.ok(app.includes('if (APP_EDITION === "global") return <GlobalApp />;'));
  assert.ok(app.includes("<AuthProvider>"));
  assert.ok(app.includes('<Route path="/login" element={<Login />} />'));
});

test("Global UI uses only Global Auth and Global business records APIs", () => {
  assert.match(globalApp, /global-auth-context/);
  assert.match(onboarding, /globalEnsureOwner/);
  assert.match(globalApp, /global-business-records/);
  assert.match(globalApp, /GlobalCountryOnboarding/);
  assert.match(globalApp, /if \(session && account && !account\.workspace_id\)/);
  assert.doesNotMatch(globalApp, /COUNTRY_OPTIONS|setCountryCode|signup_country_code/);
  assert.match(onboarding, /Select your country/);
  assert.match(onboarding, /Language and number format/);
  assert.doesNotMatch(globalApp, /hydrateWorkspaceData|workspace-records|from\(["']profiles["']\)/);
});

test("Global UI enables inventory movements while keeping invoice creation and payments disabled", () => {
  assert.match(globalApp, /Invoice creation and payment collection are not enabled yet/);
  assert.match(globalApp, /global-stock-movements/);
  assert.match(globalApp, /const TABLES = \{ clients: "clients", products: "products", expenses: "expenses"/);
  assert.match(globalApp, /tab === "invoices" \? "Read-only until invoice and payment workflows are enabled\."/);
});

test("Global Cloudflare build targets its own Worker and edition config", () => {
  const config = JSON.parse(worker);
  assert.equal(config.name, "plivex-global");
  assert.equal(config.vars.VITE_APP_EDITION, "global");
  assert.match(vite, /wrangler\.global\.jsonc/);
  assert.match(vite, /VITE_APP_EDITION: edition/);
});

test("Unified same-domain worker preserves India at root and serves Global under /global", () => {
  const config = JSON.parse(indiaWorker);
  assert.equal(config.name, "plivex-in");
  assert.equal(config.vars.VITE_APP_EDITION, "unified");
  assert.equal(config.previews.vars.VITE_APP_EDITION, "unified");
  assert.match(vite, /\|\| 'unified'/);
  assert.match(googleButton, /APP_EDITION === "global" \? "\/global\/" : "\/"/);
  assert.match(globalApp, /href="\/global\/"|href=\{?"\/global\/"?\}/);
});

test("Global and India email callbacks preserve their same-origin edition path", () => {
  const backend = read("../../api/backendClient.js");
  assert.match(backend, /resolveRuntimeEdition\(import\.meta\.env\.VITE_APP_EDITION/);
  assert.match(backend, /APP_EDITION === "global" \? "\/global\/" : "\/"/);
});
