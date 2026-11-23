import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261116120000_global_enterprise_controls.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../../../supabase/functions/global-enterprise/index.ts", import.meta.url), "utf8");
const exportEdge = readFileSync(new URL("../../../supabase/functions/global-export/index.ts", import.meta.url), "utf8");
const hardening = readFileSync(new URL("../../../supabase/migrations/20261116123000_global_enterprise_hardening.sql", import.meta.url), "utf8");
const delegation = readFileSync(new URL("../../../supabase/migrations/20261123020000_global_member_permission_delegation.sql", import.meta.url), "utf8");

test("enterprise migration keeps Global data in private schema and enables RLS", () => {
  for (const table of ["workspace_branches", "workspace_permission_overrides", "approval_requests", "audit_events", "export_jobs", "workspace_retention_policies", "exchange_rate_snapshots", "currency_conversion_history", "tax_rule_versions"]) {
    assert.match(migration, new RegExp("create table if not exists global\\." + table));
    assert.match(migration, new RegExp("alter table global\\." + table + " enable row level security"));
  }
});
test("enterprise RPC is service-role-only and rechecks workspace membership", () => {
  assert.match(migration, /global_enterprise_action/);
  assert.match(migration, /exchange_rate_snapshots_immutable/);
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

test("export worker is JWT-protected, private-storage-only and checks ownership before signed download", () => {
  assert.match(exportEdge, /authenticateGlobal/);
  assert.match(exportEdge, /public:\s*false/);
  assert.match(exportEdge, /global_export_claim/);
  assert.match(exportEdge, /global_export_dataset/);
  assert.match(exportEdge, /global_export_download_path/);
  assert.match(exportEdge, /createSignedUrl/);
  assert.match(migration, /global_export_complete/);
  assert.match(migration, /global_export_fail/);
});

test("retention cleanup is admin-checked and removes expired private exports", () => {
  assert.match(migration, /global_retention_candidates/);
  assert.match(migration, /global_retention_cleanup_audit/);
  assert.match(migration, /global_retention_mark_expired/);
  assert.match(hardening, /global_can_export/);
  assert.match(hardening, /global_cancel_approval_request/);
  assert.match(hardening, /global.guard_audit_event_mutation/);
  assert.match(exportEdge, /body.action === "cleanup"/);
});

test("workspace health snapshot is admin-gated and reports only operational counts", () => {
  assert.match(migration, /health\.read/);
  assert.match(migration, /failedExportsLast24h/);
  assert.match(edge, /health\.read/);
});


test("member directory RPC is workspace-scoped and service-role-only", () => {
  assert.match(delegation, /public\.global_enterprise_members/);
  assert.match(delegation, /where workspace_id = p_workspace_id/);
  assert.match(delegation, /user_id = p_user_id/);
  assert.match(delegation, /status = 'active'/);
  assert.match(delegation, /not in \('owner', 'admin'\)/);
  assert.match(delegation, /revoke all on function public\.global_enterprise_members\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(delegation, /grant execute on function public\.global_enterprise_members\(uuid, uuid\) to service_role/);
});
