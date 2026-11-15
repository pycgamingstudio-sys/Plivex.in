import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shared = await readFile(new URL("../../../supabase/functions/_shared/global.ts", import.meta.url), "utf8");

test("Global Edge Functions accept only the unified Plivex site origins", () => {
  assert.match(shared, /"https:\/\/plivex\.in"/);
  assert.match(shared, /"https:\/\/www\.plivex\.in"/);
  assert.doesNotMatch(shared, /"https:\/\/global\.plivex\.in"/);
  assert.match(shared, /: "https:\/\/plivex\.in"/);
});
