import test from "node:test";
import assert from "node:assert/strict";
import { isShareLinkOwner } from "./authorization.mjs";

test("allows the authenticated creator to manage their share link", () => {
  assert.equal(isShareLinkOwner({ created_by: "user-a" }, "user-a"), true);
});

test("does not allow another workspace user to manage someone else's link", () => {
  assert.equal(isShareLinkOwner({ created_by: "user-a" }, "user-b"), false);
});

test("fails closed for missing link or missing creator identity", () => {
  assert.equal(isShareLinkOwner(null, "user-a"), false);
  assert.equal(isShareLinkOwner({}, "user-a"), false);
  assert.equal(isShareLinkOwner({ created_by: "user-a" }, null), false);
  assert.equal(isShareLinkOwner({ created_by: "user-a" }, ""), false);
});
