import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the application mounts one shared router instead of a separate GlobalApp", () => {
  const app = read("../../App.jsx");
  assert.doesNotMatch(app, /import\s+GlobalApp\s+from/);
  assert.doesNotMatch(app, /return\s+<GlobalApp\s*\/>/);
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /element={<AppLayout \/>}/);
});

test("unified authentication resolves workspace country before selecting regional handlers", () => {
  const auth = read("../../lib/AuthContext.jsx");
  const backend = read("../../api/backendClient.js");
  assert.match(auth, /resolveSignedInEdition\(currentUser\)/);
  assert.match(auth, /resolveWorkspaceEdition\(countryCode, supportedCodes\)/);
  assert.match(auth, /setRuntimeEdition\(edition\)/);
  assert.match(auth, /const wasGlobalWorkspace = APP_EDITION === 'global'/);
  assert.match(auth, /migrateLegacy: !wasGlobalWorkspace/);
  assert.match(backend, /export let APP_EDITION/);
  assert.match(backend, /export const isUnifiedBuild/);
});

test("Global country onboarding uses the shared Plivex brand", () => {
  const onboarding = read("../../components/global/GlobalCountryOnboarding.jsx");
  assert.match(onboarding, /<p className="text-sm font-semibold text-primary">Plivex<\/p>/);
  assert.doesNotMatch(onboarding, />Plivex Global</);
  assert.match(onboarding, /filter\(\(entry\) => entry.code !== "IN"\)/);
});
