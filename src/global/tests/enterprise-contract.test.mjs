import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/202611160001_global_enterprise_controls.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../../../../supabase/functions/global-enterprise/index.ts", import.meta.url), "utf8");

test("enterprise migration keeps Global data in private schema and enables RLS", () => {
  for (const table of ["workspace_branches", "workspace_permission_overrides", "approval_requests", "audit_events", "export_jobs", "workspace_retention_policies", "exchange_rate_snapshots", "tax_rule_versions"]) {
    assert.match(migration, new RegExp("create table if not exists global\\." + table));
    assert.match(migration, new RegExp("alter table global\\." + table + " enable row level security"));
  }
});
test("enterprise RPC is service-role-only and rechecks workspace membership", () => {
  assert.match(migration, /global_enterprise_action/);
  assert.match(migration, /status='active'/);
  assert.match(migration, /revoke all on function public\.global_enterprise_action[^;]+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.global_enterprise_action[^;]+to service_role/i);
});
test("enterprise edge function authenticates, rate-limits and delegates to guarded RPC", () => {
  assert.match(edge, /authenticateGlobal/);
  assert.match(edge, /global_consume_enterprise_rate_limit/);
  assert.match(edge, /global_enterprise_action/);
  assert.doesNotMatch(edge, /schema\(["']global["']\)/);
});
