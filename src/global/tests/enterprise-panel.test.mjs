import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../../components/global/GlobalEnterprisePanel.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../GlobalApp.jsx", import.meta.url), "utf8");

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
  assert.match(panel, /Prevent requesters from approving their own action/);
  assert.match(panel, /approvalExpenseAmount/);
  assert.ok(panel.includes('resourceId: isExpenseApproval && approvalAction.trim() === "expense.create" ? "*" : resourceId.trim()'));
  assert.match(panel, /invoice write gates/);\n  assert.match(panel, /invoice.payment.record/);\n  assert.match(panel, /eventDate: approvalExpenseDate/);
});
