import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [app, globalApp, worker, vite] = await Promise.all([
  read("../../App.jsx"),
  read("../GlobalApp.jsx"),
  read("../../../wrangler.global.jsonc"),
  read("../../../vite.config.js"),
]);

test("Global edition reuses the shared India landing, login, signup and app route tree", () => {
  assert.doesNotMatch(app, /import GlobalApp from "@\/global\/GlobalApp\.jsx"/);
  assert.doesNotMatch(app, /if \(APP_EDITION === "global"\) return <GlobalApp \/>/);
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /<Route path="\/login" element={<Login \/>} \/>/);
  assert.match(app, /<Route path="\/register" element={<Register \/>} \/>/);
  assert.match(app, /<Route path="\/" element={<HomeGate \/>} \/>/);
});

test("Global UI uses only Global Auth and Global business records APIs", () => {
  assert.match(globalApp, /global-auth-context/);
  assert.match(globalApp, /global-ensure-owner/);
  assert.match(globalApp, /global-business-records/);
  assert.doesNotMatch(globalApp, /hydrateWorkspaceData|workspace-records|from\(["']profiles["']\)/);
});

test("Global UI does not expose unfinished invoice creation or inventory mutations", () => {
  assert.match(globalApp, /Invoice creation, payment collection and stock movements are not enabled yet/);
  assert.match(globalApp, /This section is read-only/);
  assert.match(globalApp, /const TABLES = \{ clients: "clients", products: "products", expenses: "expenses"/);
});

test("Global Cloudflare build targets its own Worker and edition config", () => {
  const config = JSON.parse(worker);
  assert.equal(config.name, "plivex-global");
  assert.equal(config.vars.VITE_APP_EDITION, "global");
  assert.match(vite, /wrangler\.global\.jsonc/);
  assert.match(vite, /VITE_APP_EDITION: edition/);
});
