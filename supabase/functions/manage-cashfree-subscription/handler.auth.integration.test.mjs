import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createManageCashfreeSubscriptionHandler } from "./handler.mjs";

const URL = Deno.env.get("TEST_SUPABASE_URL") || "http://127.0.0.1:3001";
const JWT_SECRET = Deno.env.get("TEST_JWT_SECRET") || "";

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwt(claims) {
  if (!JWT_SECRET) throw new Error("TEST_JWT_SECRET is required");
  const encoder = new TextEncoder();
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64Url(encoder.encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(header + "." + payload)));
  return header + "." + payload + "." + base64Url(signature);
}

async function makeKeys() {
  const now = Math.floor(Date.now() / 1000);
  const common = { iss: "supabase", aud: "authenticated", iat: now, exp: now + 3600 };
  return {
    anon: await signJwt({ ...common, role: "anon" }),
    service: await signJwt({ ...common, role: "service_role" }),
  };
}

Deno.test("real Supabase Auth user verification reaches the actual Cashfree handler and PostgREST", async () => {
  const keys = await makeKeys();
  const admin = createClient(URL, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = "stage4-auth-" + crypto.randomUUID() + "@example.test";
  const password = "Stage4-" + crypto.randomUUID() + "-Aa9!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("GoTrue admin.createUser failed: " + (created.error?.message || "missing user"));

  const userId = created.data.user.id;
  const workspaceId = "workspace-auth-" + userId;
  const subscriptionId = crypto.randomUUID();
  const profileInsert = await admin.from("profiles").insert({ id: userId, workspace_id: workspaceId, role: "admin" });
  if (profileInsert.error) throw new Error("Could not create Auth integration profile: " + profileInsert.error.message);

  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const subscriptionInsert = await admin.from("subscriptions").insert({
    id: subscriptionId, workspace_id: workspaceId, gateway: "cashfree", provider: "cashfree",
    status: "active", started_at: startedAt, expires_at: expiresAt,
    cancel_at_period_end: false, cancellation_requested_at: null, updated_at: startedAt,
  });
  if (subscriptionInsert.error) throw new Error("Could not create Auth integration subscription: " + subscriptionInsert.error.message);

  const signedIn = await admin.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session?.access_token) throw new Error("GoTrue sign-in failed: " + (signedIn.error?.message || "missing session"));
  const accessToken = signedIn.data.session.access_token;

  const handler = createManageCashfreeSubscriptionHandler({
    createClient,
    getEnv: (name) => ({
      SUPABASE_URL: URL,
      SUPABASE_ANON_KEY: keys.anon,
      SUPABASE_SERVICE_ROLE_KEY: keys.service,
    })[name],
  });
  const request = (action, token = accessToken) => handler(new Request(URL + "/functions/v1/manage-cashfree-subscription", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Origin: "https://plivex.in" },
    body: JSON.stringify({ action }),
  }));

  const cancel = await request("cancel");
  const cancelBody = await cancel.json();
  if (cancel.status !== 200 || cancelBody.cancelAtPeriodEnd !== true) throw new Error("Real Auth cancel failed: " + cancel.status + " " + JSON.stringify(cancelBody));

  const persistedCancel = await admin.from("subscriptions").select("cancel_at_period_end,cancellation_requested_at").eq("id", subscriptionId).single();
  if (persistedCancel.error || persistedCancel.data.cancel_at_period_end !== true || !persistedCancel.data.cancellation_requested_at) {
    throw new Error("Real Auth cancellation was not persisted through PostgREST");
  }

  const invalid = await request("cancel", "invalid-or-expired-test-token");
  if (invalid.status !== 401) throw new Error("GoTrue did not reject invalid bearer token: " + invalid.status);
  const afterInvalid = await admin.from("subscriptions").select("cancel_at_period_end").eq("id", subscriptionId).single();
  if (afterInvalid.error || afterInvalid.data.cancel_at_period_end !== true) throw new Error("Invalid token changed subscription state");

  const resume = await request("resume");
  const resumeBody = await resume.json();
  if (resume.status !== 200 || resumeBody.cancelAtPeriodEnd !== false) throw new Error("Real Auth resume failed: " + resume.status + " " + JSON.stringify(resumeBody));
  const persistedResume = await admin.from("subscriptions").select("cancel_at_period_end,cancellation_requested_at").eq("id", subscriptionId).single();
  if (persistedResume.error || persistedResume.data.cancel_at_period_end !== false || persistedResume.data.cancellation_requested_at !== null) {
    throw new Error("Real Auth resume was not persisted through PostgREST");
  }
  console.log("PASS: actual GoTrue auth.getUser(), profile RLS, Cashfree handler cancel/resume and PostgREST persistence");
});
