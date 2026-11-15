import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../GlobalApp.jsx", import.meta.url), "utf8");

test("Global inventory UI invokes the audited stock movement endpoint", () => {
  assert.match(source, /global-stock-movements/);
  assert.match(source, /idempotency_key:\s*crypto\.randomUUID\(\)/);
  assert.match(source, /movement_type:\s*movementType/);
  assert.match(source, /quantity_delta:\s*quantityDelta/);
  assert.match(source, /workspace_id:\s*account\.workspace_id/);
});

test("Global inventory UI constrains product choices and displays product names", () => {
  assert.match(source, /records\.products \|\| \[\]/);
  assert.match(source, /product\.is_active !== false/);
  assert.match(source, /find\(\(product\) => product\.id === record\.product_id\)/);
});

test("Global UI no longer claims stock movements are disabled", () => {
  assert.doesNotMatch(source, /stock movements are not enabled yet/);
  assert.match(source, /Record stock receipts, sales, returns and adjustments/);
});
