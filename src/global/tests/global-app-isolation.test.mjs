import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("all seven country workspaces use one authenticated Main Workspace shell", async () => {
  const app = await read("../../App.jsx");
  const auth = await read("../../lib/AuthContext.jsx");
  const layout = await read("../../components/AppLayout.jsx");
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /<AppLayout \/>/);
  assert.match(app, /All supported countries use the same Main Workspace routes/);
  assert.doesNotMatch(app, /GlobalApp|isGlobalWorkspace/);
  assert.match(auth, /if \(isUnifiedBuild\)/);
  assert.match(auth, /setRuntimeEdition\("india"\)/);
  assert.doesNotMatch(auth, /global-auth-context/);
  assert.match(layout, /Workspace/);
});

test("country onboarding provisions a canonical workspace and does not invoke legacy Global provisioning", async () => {
  const onboarding = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  const app = await read("../../App.jsx");
  assert.match(onboarding, /ensureOwnerRole/);
  assert.doesNotMatch(onboarding, /globalEnsureOwner/);
  assert.match(app, /UnifiedWorkspaceOnboarding/);
  assert.doesNotMatch(app, /GlobalApp/);
});

test("the single-domain build uses the existing Plivex Worker configuration", async () => {
  const worker = JSON.parse(await read("../../../wrangler.jsonc"));
  const vite = await read("../../../vite.config.js");
  assert.equal(worker.name, "plivex-in");
  assert.doesNotMatch(vite, /wrangler\.global\.jsonc/);
});
