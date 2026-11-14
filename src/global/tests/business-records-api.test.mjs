import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [backend, handler, shared] = await Promise.all([
  read("../../api/backendClient.js"),
  read("../../../supabase/functions/global-business-records/index.ts"),
  read("../../../supabase/functions/_shared/global.ts"),
]);

test("Global app can invoke only the dedicated Global business records function", () => {
  assert.match(backend, /!\["global-ensure-owner", "global-business-records"\]\.includes\(functionName\)/);
  assert.match(backend, /"global-business-records", "workspace-records"/);
  assert.match(handler, /\.schema\("global"\)\.from\(table\)/);
});

test("Global records API verifies the caller and active workspace membership", () => {
  assert.match(shared, /authClient\.auth\.getUser\(\)/);
  assert.match(handler, /\.from\("workspace_members"\)/);
  assert.match(handler, /\.eq\("user_id", auth\.user\.id\)/);
  assert.match(handler, /\.eq\("status", "active"\)/);
  assert.match(handler, /if \(!membership\) return globalJson/);
});

test("Global record writes are allowlisted and role-scoped", () => {
  assert.match(handler, /const TABLE_FIELDS/);
  assert.match(handler, /function canWrite/);
  assert.match(handler, /READ_ONLY_TABLES/);
  assert.match(handler, /created_by: auth\.user\.id/);
  assert.match(handler, /\.eq\("workspace_id", workspaceId\)/);
  assert.doesNotMatch(handler, /\.from\("(?:profiles|clients|products|expenses)"\)/);
});

test("Global records reject invalid amounts, currencies, fields, and oversized bodies", () => {
  assert.match(handler, /Number\.isSafeInteger/);
  assert.match(handler, /workspace currency/);
  assert.match(handler, /One or more fields are not supported/);
  assert.match(handler, /MAX_BODY_BYTES/);
});

test("Global records never fall back to India public workspace endpoints", () => {
  assert.doesNotMatch(handler, /\.schema\("public"\)|\.from\("profiles"\)|workspace-records/);
  assert.match(handler, /"global"/);
});
