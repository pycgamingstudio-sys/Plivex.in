import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261123020000_global_multilevel_approvals_escalation.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../../../supabase/functions/global-enterprise/index.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../../components/global/GlobalEnterprisePanel.jsx", import.meta.url), "utf8");

test("approval requests receive ordered approval steps and bounded policy levels", () => {
  assert.match(migration, /create table if not exists global\.approval_request_steps/);
  assert.match(migration, /approval_levels jsonb/);
  assert.match(migration, /current_level integer/);
  assert.match(migration, /total_levels integer/);
  assert.match(migration, /global\.seed_approval_request_steps/);
  assert.match(migration, /after insert on global\.approval_requests/);
  assert.match(migration, /global_approval_request_v2/);
  assert.match(migration, /global_approval_decide_v2/);
  assert.match(migration, /global_approval_cancel_v2/);
  assert.match(migration, /global_approval_list_v2/);
});

test("approval escalation is scheduled, audited and restricted to the service role", () => {
  assert.match(migration, /global_escalate_due_approvals/);
  assert.match(migration, /approval\.escalated/);
  assert.match(migration, /cron\.schedule\('plivex-global-approval-escalation','\*\/5 \* \* \* \*'/);
  assert.match(migration, /revoke all on function public\.global_escalate_due_approvals\(\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.global_escalate_due_approvals\(\) to service_role/);
});

test("enterprise Edge Function routes approval actions through the sequential workflow RPCs", () => {
  assert.match(edge, /global_approval_request_v2/);
  assert.match(edge, /global_approval_decide_v2/);
  assert.match(edge, /global_approval_cancel_v2/);
  assert.match(edge, /global_approval_list_v2/);
  assert.match(edge, /global_set_approval_policy_v2/);
  assert.match(edge, /global_list_approval_policies_v2/);
  assert.match(edge, /approvalLevels/);
  assert.match(edge, /escalationAfterHours/);
  assert.match(edge, /escalationRole/);
});

test("Enterprise UI configures ordered levels and shows step and escalation status", () => {
  assert.match(panel, /Sequential approval levels/);
  assert.match(panel, /Add approval level/);
  assert.match(panel, /Escalate after \(hours\)/);
  assert.match(panel, /Escalate to role/);
  assert.match(panel, /Level \{item\.current_level/);
  assert.match(panel, /escalated to/);
});
