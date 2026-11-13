import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
const vars = config.vars || {};
const required = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_API_BASE_URL"];
const assetsDir = "dist/assets";
const assets = readdirSync(assetsDir)
  .filter((name) => /\.(?:js|css)$/.test(name))
  .map((name) => readFileSync(join(assetsDir, name), "utf8"));
const bundle = assets.join("\n");

for (const key of required) {
  const value = vars[key];
  assert.equal(typeof value, "string", `wrangler.jsonc is missing ${key}`);
  assert.ok(value.length > 0, `wrangler.jsonc has an empty ${key}`);
  assert.ok(bundle.includes(value), `Built assets do not contain configured ${key}`);
}

assert.ok(!bundle.includes("http://invalid.local"), "Build contains the invalid Supabase URL fallback");
assert.ok(!bundle.includes("missing-key"), "Build contains the missing Supabase key fallback");

console.log("PASS: built assets contain the configured public Supabase and API settings (values redacted)");
