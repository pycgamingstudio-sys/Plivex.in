import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dashboard = readFileSync(new URL("../../pages/Dashboard.jsx", import.meta.url), "utf8");

test("workspace edition badge follows the authenticated workspace country", () => {
  assert.match(dashboard, /String\(user\?\.country_code \|\| "IN"\)/);
  assert.match(dashboard, /workspaceCountryCode === "IN" \? "India Workspace" : "Global Workspace"/);
  assert.doesNotMatch(dashboard, /workspaceEditionLabel = APP_EDITION/);
});
