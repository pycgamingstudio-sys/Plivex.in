import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
const entrypoint = resolve(root, "supabase/functions/assistant-confirm/source/index.ts");
const configText = readFileSync(resolve(root, "supabase/config.toml"), "utf8");

test("deployed assistant-confirm v24 entrypoint and JWT gateway setting are versioned", () => {
  assert.ok(existsSync(entrypoint));
  assert.match(configText, /\[functions\.assistant-confirm\][\s\S]*?verify_jwt\s*=\s*true/);
});

test("all relative assistant-confirm imports resolve", () => {
  const source = readFileSync(entrypoint, "utf8");
  const imports = [...source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].map((match) => match[1]);
  assert.ok(imports.length >= 8);
  for (const specifier of imports) assert.ok(existsSync(resolve(dirname(entrypoint), specifier)), specifier);
});
