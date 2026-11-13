import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readFunction = (name) => readFileSync(
  new URL(`../../../supabase/functions/${name}/index.ts`, import.meta.url),
  "utf8",
);

const sources = [
  ["assistant-chat", readFunction("assistant-chat")],
  ["assistant-confirm", readFunction("assistant-confirm")],
];

for (const [name, source] of sources) {
  test(`${name} preserves a sanitized invoice snapshot through validation`, () => {
    const start = source.indexOf("function validateAction");
    const end = source.indexOf("\n}\n", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const validator = source.slice(start, end);
    assert.match(validator, /rawSnapshot[\s\S]*invoice_snapshot/);
    assert.match(validator, /currency,[\s\S]*items:\s*items\.map/);
    assert.match(validator, /rate:\s*item\.rate/);
    assert.match(validator, /gstRate:\s*item\.gst_rate/);
    assert.match(validator, /invoice_snapshot\s*,/);
  });
}

test("both validators bind snapshot currency to validated payload currency", () => {
  for (const [, source] of sources) {
    const start = source.indexOf("function validateAction");
    const end = source.indexOf("\n}\n", start);
    const validator = source.slice(start, end);
    assert.match(validator, /const currency = text\((?:p|raw)\.currency[\s\S]*?SUPPORTED_CURRENCIES/);
    assert.match(validator, /dueDate:[\s\S]*?currency,/);
  }
});
