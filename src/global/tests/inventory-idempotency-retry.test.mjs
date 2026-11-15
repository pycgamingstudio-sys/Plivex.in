import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../GlobalApp.jsx", import.meta.url), "utf8");

test("Global stock movement retries reuse the same idempotency key for identical payloads", () => {
  assert.match(source, /movementRequest\?\.signature === signature \? movementRequest\.id : crypto\.randomUUID\(\)/);
  assert.match(source, /setMovementRequest\(\{ signature, id: requestId \}\)/);
  assert.match(source, /setMovementRequest\(null\)/);
  assert.match(source, /body: \{ \.\.\.movementPayload, idempotency_key: requestId \}/);
});
