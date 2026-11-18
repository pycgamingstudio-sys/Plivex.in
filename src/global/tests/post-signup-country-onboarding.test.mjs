import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("unified signup authenticates first and collects country after sign-in", async () => {
  const register = await read("../../pages/Register.jsx");
  const google = await read("../../components/auth/GoogleSignInButton.jsx");
  const backend = await read("../../api/backendClient.js");
  const onboarding = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  assert.match(register, /db\.auth\.register\(\{ email, password \}\)/);
  assert.doesNotMatch(register, /signup-country|Business country/);
  assert.match(google, /countryCode = ""/);
  assert.match(google, /APP_EDITION !== "global" && countryCode/);
  assert.match(backend, /signupMetadata/);
  assert.match(onboarding, /Create my workspace/);
  assert.doesNotMatch(onboarding, /globalEnsureOwner/);
  assert.match(onboarding, /ensureOwnerRole/);
  assert.match(onboarding, /businessType: workTypes\[0\]/);
  assert.match(onboarding, /optionalFeatures: features/);
  assert.match(onboarding, /plivex_work_types: workTypes/);
  assert.match(onboarding, /plivex_workspace_features: features/);
});

test("new unified identities are held at onboarding before workspace provisioning", async () => {
  const auth = await read("../../lib/AuthContext.jsx");
  const app = await read("../../App.jsx");
  const onboarding = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  assert.match(auth, /Unified signup is authenticated first/);
  assert.match(auth, /setIsAuthenticated\(true\)/);
  assert.match(app, /UnifiedWorkspaceOnboarding/);
  assert.match(onboarding, /Choose your country/);
  assert.match(onboarding, /controlled reset or migration/);
  assert.match(onboarding, /Create my workspace/);
});

test("unified runtime does not resolve a second Global workspace identity", async () => {
  const auth = await read("../../lib/AuthContext.jsx");
  const app = await read("../../App.jsx");
  assert.match(auth, /if \(isUnifiedBuild\) \{[\s\S]*setRuntimeEdition\("india"\);[\s\S]*return currentUser;/);
  assert.match(app, /\(!user\.workspace_id \|\| !user\.country_code\)/);
});

test("Global owner provisioning rejects a missing country instead of defaulting to India", async () => {
  const edgeFunction = await read("../../../supabase/functions/ensure-owner-role/index.ts");
  assert.match(edgeFunction, /Choose a supported business country before creating your workspace/);
  assert.match(edgeFunction, /Choose a valid regional format for your selected country/);
  assert.doesNotMatch(edgeFunction, /requestedCountry.*: "IN"/);
});
