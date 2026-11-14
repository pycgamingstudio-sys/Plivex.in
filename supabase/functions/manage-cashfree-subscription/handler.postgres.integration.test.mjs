import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createManageCashfreeSubscriptionHandler } from "./handler.mjs";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SUBSCRIPTION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "workspace-postgrest";
const URL = Deno.env.get("TEST_SUPABASE_URL") || "http://127.0.0.1:3000";
const JWT_SECRET = Deno.env.get("TEST_JWT_SECRET") || "";
const ANON_KEY = "disposable-anon-key";

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwt(claims) {
  if (!JWT_SECRET) throw new Error("TEST_JWT_SECRET is required");
  const encoder = new TextEncoder();
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64Url(encoder.encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(header + "." + payload)));
  return header + "." + payload + "." + base64Url(signature);
}

async function createHandler() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const userToken = await signJwt({
    role: "authenticated",
    sub: USER_ID,
    aud: "authenticated",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });
  const serviceToken = await signJwt({
    role: "service_role",
    aud: "authenticated",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });
  const createDbClient = (url, key, options) => {
    const client = createClient(url, key, options);
    if (key === ANON_KEY) {
      // Only Supabase Auth identity lookup is stubbed. Profile and subscription
      // reads/writes below go through real Supabase JS -> PostgREST -> PostgreSQL.
      client.auth.getUser = async () => ({
        data: { user: { id: USER_ID, email: "admin@example.test" } },
        error: null,
      });
    }
    return client;
  };
  const handler = createManageCashfreeSubscriptionHandler({
    createClient: createDbClient,
    getEnv: (name) => ({
      SUPABASE_URL: URL,
      SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: serviceToken,
    })[name],
    now: () => new Date(),
  });
  const admin = createClient(URL, serviceToken);
  return {
    handler,
    admin,
    request: (action) => handler(new Request(URL + "/functions/v1/manage-cashfree-subscription", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + userToken,
        "Content-Type": "application/json",
        Origin: "https://plivex.in",
      },
      body: JSON.stringify({ action }),
    })),
  };
}

Deno.test("actual subscription handler reads and updates disposable PostgreSQL through PostgREST", async () => {
  const { handler, admin, request } = await createHandler();

  const cancelResponse = await request("cancel");
  const cancelBody = await cancelResponse.json();
  if (cancelResponse.status !== 200 || cancelBody.cancelAtPeriodEnd !== true) {
    throw new Error("Handler cancel request failed: " + cancelResponse.status + " " + JSON.stringify(cancelBody));
  }

  const afterCancel = await admin.from("subscriptions")
    .select("workspace_id,gateway,provider,status,cancel_at_period_end,cancellation_requested_at,updated_at")
    .eq("id", SUBSCRIPTION_ID)
    .single();
  if (afterCancel.error) throw new Error("Could not read PostgreSQL state after cancel: " + afterCancel.error.message);
  if (afterCancel.data.workspace_id !== WORKSPACE_ID
    || afterCancel.data.cancel_at_period_end !== true
    || !afterCancel.data.cancellation_requested_at) {
    throw new Error("Cancel response did not match persisted PostgreSQL state");
  }

  const resumeResponse = await request("resume");
  const resumeBody = await resumeResponse.json();
  if (resumeResponse.status !== 200 || resumeBody.cancelAtPeriodEnd !== false) {
    throw new Error("Handler resume request failed: " + resumeResponse.status + " " + JSON.stringify(resumeBody));
  }

  const afterResume = await admin.from("subscriptions")
    .select("cancel_at_period_end,cancellation_requested_at,updated_at")
    .eq("id", SUBSCRIPTION_ID)
    .single();
  if (afterResume.error) throw new Error("Could not read PostgreSQL state after resume: " + afterResume.error.message);
  if (afterResume.data.cancel_at_period_end !== false || afterResume.data.cancellation_requested_at !== null) {
    throw new Error("Resume response did not match persisted PostgreSQL state");
  }

  const statusResponse = await request("status");
  const statusBody = await statusResponse.json();
  if (statusResponse.status !== 200 || statusBody.available !== true || statusBody.cancelAtPeriodEnd !== false) {
    throw new Error("Handler status request did not reflect persisted PostgreSQL state");
  }
});
