import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const edition = process.env.VITE_APP_EDITION === "global" ? "global" : "india";
const configPath = edition === "global" ? "wrangler.global.jsonc" : "wrangler.jsonc";
const config = JSON.parse(readFileSync(configPath, "utf8"));
const vars = config.vars || {};
const required = edition === "global"
  ? ["VITE_APP_EDITION", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]
  : ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_API_BASE_URL"];
const assetsDir = "dist/assets";
const assets = readdirSync(assetsDir)
  .filter((name) => /\.(?:js|css)$/.test(name))
  .map((name) => readFileSync(join(assetsDir, name), "utf8"));
const bundle = assets.join("\n");

for (const key of required) {
  const value = vars[key];
  assert.equal(typeof value, "string", `${configPath} is missing ${key}`);
  assert.ok(value.length > 0, `${configPath} has an empty ${key}`);
  assert.ok(bundle.includes(value), `Built assets do not contain configured ${key}`);
}

if (edition === "global") {
  assert.equal(config.name, "plivex-global", "Global build must target the isolated Worker");
  assert.ok(!bundle.includes("member-sync-flow.lovable.app"), "Global build must not embed the India API endpoint");
}

assert.ok(!bundle.includes("http://invalid.local"), "Build contains the invalid Supabase URL fallback");
assert.ok(!bundle.includes("missing-key"), "Build contains the missing Supabase key fallback");

console.log(`PASS: ${edition} built assets match the selected public Worker configuration (values redacted)`);
