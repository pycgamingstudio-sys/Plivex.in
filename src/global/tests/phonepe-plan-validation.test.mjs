import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../../supabase/functions/_shared/phonepe.ts", import.meta.url), "utf8");

test("PhonePe activation narrows untrusted order plan ids before plan lookup", () => {
  assert.match(source, /const planId = typeof order\?\.plan_id === "string" \? order\.plan_id : ""/);
  assert.match(source, /!isPlanId\(planId\)/);
  assert.match(source, /PLANS\[planId\]\.period/);
  assert.doesNotMatch(source, /PLANS\[order\.plan_id\]/);
});
