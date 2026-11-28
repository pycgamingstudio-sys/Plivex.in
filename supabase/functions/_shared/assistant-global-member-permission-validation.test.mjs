import test from "node:test";
import assert from "node:assert/strict";
import { validateGlobalMemberPermissionAction, validateGlobalMemberPermissionAgainstContext } from "./assistant-global-member-permission-validation.mjs";

const memberId = "33333333-3333-4333-8333-333333333333";

test("validates only supported per-member permission changes", () => {
  assert.deepEqual(validateGlobalMemberPermissionAction({ type: "set_global_member_permission", payload: {
    member_id: memberId, permission_key: "invoice.read", effect: "grant"
  }}), { type: "set_global_member_permission", payload: {
    member_id: memberId, permission_key: "invoice.read", effect: "grant"
  }});
  assert.equal(validateGlobalMemberPermissionAction({ type: "set_global_member_permission", payload: {
    member_id: memberId, permission_key: "drop.database", effect: "grant"
  }}), null);
  assert.equal(validateGlobalMemberPermissionAction({ type: "set_global_member_permission", payload: {
    member_id: memberId, permission_key: "invoice.read", effect: "allow"
  }}), null);
});

test("requires a known active non-admin member and rejects no-op changes", () => {
  const action = validateGlobalMemberPermissionAction({ type: "set_global_member_permission", payload: {
    member_id: memberId, permission_key: "invoice.read", effect: "grant"
  }});
  const context = { members: [{ id: memberId, email: "staff@example.com", role: "employee", status: "active", permission_overrides: [] }] };
  assert.equal(validateGlobalMemberPermissionAgainstContext(action, context).ok, true);
  assert.equal(validateGlobalMemberPermissionAgainstContext(action, { members: [{ ...context.members[0], permission_overrides: [{ permission_key: "invoice.read", effect: "grant" }] }] }).reason, "already_set");
  assert.equal(validateGlobalMemberPermissionAgainstContext(action, { members: [{ ...context.members[0], role: "admin" }] }).reason, "admin_override_not_supported");
  assert.equal(validateGlobalMemberPermissionAgainstContext(action, { members: [] }).reason, "member_not_found");
  assert.equal(validateGlobalMemberPermissionAgainstContext(action, { context_unavailable: true }).reason, "context_unavailable");
});
