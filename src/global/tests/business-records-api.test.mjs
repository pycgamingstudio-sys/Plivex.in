import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [backend, handler, shared, rpc] = await Promise.all([
  read("../../api/backendClient.js"),
  read("../../../supabase/functions/global-business-records/index.ts"),
  read("../../../supabase/functions/_shared/global.ts"),
  read("../../../supabase/migrations/202611150004_global_business_records_rpc.sql"),
]);

test("Global app can invoke only the dedicated Global business records function", () => {
  assert.match(backend, /!\["global-ensure-owner", "global-business-records"\]\.includes\(functionName\)/);
  assert.match(backend, /"global-business-records", "workspace-records"/);
  assert.match(handler, /\.rpc\("global_business_records"/);
});

test("Global records API verifies the bearer user and RPC rechecks active workspace membership", () => {
  assert.match(shared, /authClient\.auth\.getUser\(\)/);
  assert.match(handler, /p_user_id: auth\.user\.id/);
  assert.match(rpc, /from global\.workspace_members wm/);
  assert.match(rpc, /wm\.status = 'active'/);
  assert.match(rpc, /reason', 'access_denied'/);
});

test("Global record writes are allowlisted, workspace-scoped and role-scoped", () => {
  assert.match(handler, /const TABLE_FIELDS/);
  assert.match(handler, /READ_ONLY_TABLES/);
  assert.match(rpc, /created_by/);
  assert.match(rpc, /where id=p_record_id and workspace_id=p_workspace_id/);
  assert.match(rpc, /v_role not in \('owner','admin','manager'\)/);
  assert.doesNotMatch(handler, /\.from\("(?:profiles|clients|products|expenses)"\)/);
});

test("Global records reject invalid amounts, currencies, fields, and oversized bodies", () => {
  assert.match(handler, /Number\.isSafeInteger/);
  assert.match(handler, /One or more fields are not supported/);
  assert.match(handler, /MAX_BODY_BYTES/);
  assert.match(rpc, /reason', 'invalid_currency'/);
});

test("Global records never expose the private Global schema or fall back to India tables", () => {
  assert.doesNotMatch(handler, /\.schema\("global"\)|\.schema\("public"\)|workspace-records/);
  assert.match(rpc, /revoke all on function public\.global_business_records.*from public, anon, authenticated/s);
  assert.match(rpc, /grant execute on function public\.global_business_records.*to service_role/s);
  assert.doesNotMatch(handler, /\.from\("profiles"\)/);
});


test("Global workspace profile reads and updates stay inside global.business_profiles", () => {
  assert.match(backend, /function invokeGlobalWorkspaceRecords/);
  assert.match(backend, /functionName === "workspace-records"/);
  assert.match(handler, /business_profiles: \[/);
  assert.match(handler, /Global business profile supports read and update only/);
  assert.match(rpc, /from global\.business_profiles where workspace_id=p_workspace_id/);
  assert.match(rpc, /update global\.business_profiles set/);
  assert.match(rpc, /v_role not in \('owner','admin'\)/);
});
