import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("India dashboard identifies the active workspace using server-resolved country", () => {
  const dashboard = read("../../pages/Dashboard.jsx");
  const backend = read("../../api/backendClient.js");
  assert.match(dashboard, /getCountryByCode\(user\?\.country_code\)/);
  assert.match(dashboard, /APP_EDITION === "india"/);
  assert.match(dashboard, /India Workspace/);
  assert.match(backend, /business_profile/);
  assert.match(backend, /workspaceRegion\?\.country_code/);
});

test("Global workspace identity is shown by the shared application layout", () => {
  const layout = read("../../components/AppLayout.jsx");
  const global = read("../GlobalApp.jsx");
  assert.match(layout, /Global Workspace/);
  assert.match(layout, /user\?\.workspace_name/);
  assert.match(layout, /user\?\.country_code/);
  assert.match(layout, /user\?\.currency_code/);
  assert.match(layout, /GLOBAL_NAV/);
  assert.match(global, /useSearchParams/);
  assert.doesNotMatch(global, /<header className="border-b border-slate-200 bg-white">/);
});
