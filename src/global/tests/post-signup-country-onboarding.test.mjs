import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Global signup defers country choice until after authentication", async () => {
  const register = await read("../../pages/Register.jsx");
  const google = await read("../../components/auth/GoogleSignInButton.jsx");
  const backend = await read("../../api/backendClient.js");
  assert.match(register, /APP_EDITION !== "global" && !inviteCode/);
  assert.match(register, /APP_EDITION === "global" \? \{ email, password \}/);
  assert.match(google, /APP_EDITION !== "global"/);
  assert.doesNotMatch(google, /plivex\.signup\.region/);
  assert.match(backend, /APP_EDITION === "global"/);
  assert.match(backend, /"global-ensure-owner", "global-business-records"/);
});

test("new Global identities are held at onboarding before workspace provisioning", async () => {
  const auth = await read("../../lib/AuthContext.jsx");
  const app = await read("../../App.jsx");
  const onboarding = await read("../../components/global/GlobalCountryOnboarding.jsx");
  assert.match(auth, /Require an explicit business-country choice before provisioning/);
  assert.match(auth, /setIsAuthenticated\(true\)/);
  assert.match(app, /GlobalCountryOnboarding/);
  assert.match(onboarding, /Please choose your business country/);
  assert.match(onboarding, /globalEnsureOwner/);
});

test("Global owner provisioning rejects a missing country instead of defaulting to India", async () => {
  const edgeFunction = await read("../../../supabase/functions/global-ensure-owner/index.ts");
  assert.match(edgeFunction, /: "";/);
  assert.match(edgeFunction, /Choose your business country before creating your workspace/);
  assert.doesNotMatch(edgeFunction, /: "IN";/);
});
