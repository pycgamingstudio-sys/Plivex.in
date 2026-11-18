import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("single workspace dashboard displays the selected country without an India-only identity", () => {
  const dashboard = read("../../pages/Dashboard.jsx");
  const backend = read("../../api/backendClient.js");
  assert.match(dashboard, /getCountryByCode\(user\?\.country_code\)/);
  assert.match(dashboard, /Workspace · \{getCountryByCode\(user\?\.country_code\)\?\.name \|\| "Choose country"\}/);
  assert.doesNotMatch(dashboard, /India Workspace/);
  assert.match(backend, /business_profile/);
  assert.match(backend, /workspaceRegion\?\.country_code/);
});

test("legacy Global layout is isolated from the single Workspace label", () => {
  const layout = read("../../components/AppLayout.jsx");
  const global = read("../GlobalApp.jsx");
  assert.match(layout, /Global Workspace/);
  assert.match(layout, /user\?\.workspace_name/);
  assert.match(layout, /user\?\.country_code/);
  assert.match(layout, /user\?\.currency_code/);
  assert.match(layout, /GLOBAL_NAV/);
  assert.match(global, /useNavigate/);
  assert.match(global, /export default function GlobalApp\(\{ section = "overview" \}\)/);
  assert.match(global, /TAB_PATHS/);
  assert.doesNotMatch(global, /<header className="border-b border-slate-200 bg-white">/);
});
