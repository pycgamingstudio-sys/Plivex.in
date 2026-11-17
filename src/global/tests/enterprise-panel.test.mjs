import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../../components/global/GlobalEnterprisePanel.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../GlobalApp.jsx", import.meta.url), "utf8");
const edge = readFileSync(new URL("../../../supabase/functions/global-enterprise/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../supabase/migrations/20261116170000_part9_expense_approval_gates.sql", import.meta.url), "utf8");

test("Global Enterprise workspace is reachable from the Global app navigation", () => {
  assert.match(app, /id: "enterprise", label: "Enterprise"/);
  assert.match(app, /<GlobalEnterprisePanel workspaceId=\{account\.workspace_id\}/);
});

test("Enterprise panel uses authenticated server functions for privileged operations", () => {
  for (const action of ["branch.list", "branch.create", "branch.archive", "approval.list", "approval.request", "approval.decide", "approval.policy.list", "approval.policy.set", "permission.set", "retention.set", "audit.list", "health.read", "export.request"]) {
    assert.ok(panel.includes(action), "missing action " + action);
  }
  assert.match(panel, /functions\.invoke\("global-enterprise"/);
  assert.match(panel, /functions\.invoke\("global-export"/);
  assert.doesNotMatch(panel, /\.from\(["'](?:workspace_branches|approval_requests|audit_events|export_jobs|workspace_permission_overrides)["']\)\.(?:insert|update|delete)/);
});

test("Enterprise panel exposes configurable server-enforced Global expense approval policies", () => {
  assert.match(panel, /approval\.policy\.list/);
  assert.match(panel, /approval\.policy\.set/);
  assert.match(panel, /Approval policies/);
  assert.match(panel, /Self-approval is always blocked for safety/);
  assert.match(panel, /preventSelfApproval: true/);
  assert.doesNotMatch(panel, /Prevent requesters from approving their own action/);
  assert.match(panel, /approvalExpenseAmount/);
  assert.ok(panel.includes('resourceId: isExpenseApproval && approvalAction.trim() === "expense.create" ? "*" : resourceId.trim()'));
  assert.match(panel, /invoice write gates/);
  assert.match(panel, /invoice.payment.record/);
  assert.match(panel, /eventDate: approvalExpenseDate/);
});

test("Read-only viewers cannot be configured as transaction approvers", () => {
  assert.match(panel, /\["owner", "admin", "manager", "accountant", "employee"\]/);
  assert.doesNotMatch(panel, /\["owner", "admin", "manager", "accountant", "employee", "viewer"\]/);
  assert.match(edge, /APPROVER_ROLES = new Set\(\["owner", "admin", "manager", "employee", "accountant"\]\)/);
  assert.doesNotMatch(edge, /APPROVER_ROLES = new Set\([^)]*viewer/);
  assert.doesNotMatch(migration, /approver_roles <@ array\[[^\]]*viewer/);
});
