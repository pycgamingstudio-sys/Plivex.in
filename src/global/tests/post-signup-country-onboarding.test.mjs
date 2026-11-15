import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Unified email and Google signup defer country choice until after authentication", async () => {
  const register = await read("../../pages/Register.jsx");
  const google = await read("../../components/auth/GoogleSignInButton.jsx");
  const backend = await read("../../api/backendClient.js");
  assert.match(register, /APP_EDITION === "india" && !inviteCode/);
  assert.match(google, /else if \(APP_EDITION === "india"\)/);
  assert.match(backend, /plivex_runtime_edition: "pending"/);
  assert.match(backend, /resolveRuntimeEdition/);
  assert.match(backend, /"global-ensure-owner", "global-business-records"/);
});

test("new unified identities pause at country onboarding and choose India or Global provisioning", async () => {
  const auth = await read("../../lib/AuthContext.jsx");
  const app = await read("../../App.jsx");
  const unified = await read("../../components/global/UnifiedCountryOnboarding.jsx");
  const global = await read("../../components/global/GlobalCountryOnboarding.jsx");
  assert.match(auth, /currentUser\?\.edition === "pending"/);
  assert.match(app, /UnifiedCountryOnboarding/);
  assert.match(unified, /plivex_runtime_edition: edition/);
  assert.match(unified, /ensureOwnerRole/);
  assert.match(unified, /globalEnsureOwner/);
  assert.match(global, /plivex_runtime_edition: "global"/);
});

test("Global owner provisioning rejects a missing country instead of defaulting to India", async () => {
  const edgeFunction = await read("../../../supabase/functions/global-ensure-owner/index.ts");
  assert.match(edgeFunction, /: "";/);
  assert.match(edgeFunction, /Choose your business country before creating your workspace/);
  assert.doesNotMatch(edgeFunction, /: "IN";/);
});
