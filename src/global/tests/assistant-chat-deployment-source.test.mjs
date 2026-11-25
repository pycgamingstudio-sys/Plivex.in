import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
const functionDir = resolve(root, "supabase/functions/assistant-chat");
const entrypoint = resolve(functionDir, "source/index.ts");
const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");

test("deployed assistant-chat entrypoint is versioned in the repository", () => {
  assert.ok(existsSync(entrypoint), "Missing deployed source/index.ts snapshot");
  assert.match(config, /\[functions\.assistant-chat\][\s\S]*?verify_jwt\s*=\s*true/);
});

test("all relative imports from the deployed assistant-chat entrypoint resolve", () => {
  const source = readFileSync(entrypoint, "utf8");
  const imports = [...source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].map((match) => match[1]);
  assert.ok(imports.length >= 10, "Expected the modular assistant-chat tool registry imports");
  for (const specifier of imports) {
    const resolved = resolve(dirname(entrypoint), specifier);
    assert.ok(existsSync(resolved), `Unresolved assistant-chat import: ${specifier}`);
  }
});

test("the deployed assistant-chat source retains all supported tool modules", () => {
  const source = readFileSync(entrypoint, "utf8");
  for (const moduleName of [
    "assistant-invoice-validation.mjs",
    "assistant-model-router.mjs",
    "assistant-global-payment-validation.mjs",
    "assistant-global-client-validation.mjs",
    "assistant-global-expense-validation.mjs",
    "assistant-global-product-validation.mjs",
    "assistant-tool-registry.mjs",
    "assistant-intent-planner.mjs",
    "assistant-business-analytics.mjs",
    "assistant-goods-receipt-validation.mjs",
    "assistant-purchase-order-validation.mjs",
    "assistant-warehouse-validation.mjs",
  ]) {
    assert.ok(source.includes(moduleName), `Missing assistant module import: ${moduleName}`);
  }
});
