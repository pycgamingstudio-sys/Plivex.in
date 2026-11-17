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

test("Global dashboard identifies the Global workspace and displays its country and currency", () => {
  const global = read("../GlobalApp.jsx");
  assert.match(global, /Global Workspace/);
  assert.match(global, /account\.workspace_name/);
  assert.match(global, /account\.country_code/);
  assert.match(global, /\{currency\}/);
  assert.doesNotMatch(global, /Plivex <span className="text-slate-500">Global<\/span>/);
});
