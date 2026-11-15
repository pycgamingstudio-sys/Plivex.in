import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [app, globalApp, onboarding, worker, unifiedWorker, vite] = await Promise.all([
  read("../../App.jsx"),
  read("../GlobalApp.jsx"),
  read("../../components/global/GlobalCountryOnboarding.jsx"),
  read("../../../wrangler.global.jsonc"),
  read("../../../wrangler.unified.jsonc"),
  read("../../../vite.config.js"),
]);

test("Global edition keeps its isolated app while unified edition routes by runtime", () => {
  assert.ok(app.includes('import GlobalApp from "@/global/GlobalApp.jsx";'));
  assert.ok(app.includes('if (APP_EDITION === "global") return <GlobalApp />;'));
  assert.match(app, /RuntimeEditionApp/);
  assert.match(app, /GlobalApp onSignOut=\{logout\}/);
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

test("Global UI does not expose unfinished invoice creation or inventory mutations", () => {
  assert.match(globalApp, /Invoice creation, payment collection and stock movements are not enabled yet/);
  assert.match(globalApp, /This section is read-only/);
  assert.ok(globalApp.includes('const TABLES = { clients: "clients", products: "products", expenses: "expenses", inventory: "stock_levels"'));
});

test("Cloudflare build configs keep Global isolated and unified on a preview Worker", () => {
  const globalConfig = JSON.parse(worker);
  const unifiedConfig = JSON.parse(unifiedWorker);
  assert.equal(globalConfig.name, "plivex-global");
  assert.equal(globalConfig.vars.VITE_APP_EDITION, "global");
  assert.equal(unifiedConfig.name, "plivex-unified-preview");
  assert.equal(unifiedConfig.vars.VITE_APP_EDITION, "unified");
  assert.match(vite, /wrangler\.global\.jsonc/);
  assert.match(vite, /wrangler\.unified\.jsonc/);
  assert.match(vite, /VITE_APP_EDITION: edition/);
});
