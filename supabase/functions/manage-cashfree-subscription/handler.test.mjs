import { createManageCashfreeSubscriptionHandler } from "./handler.mjs";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";
const NOW = "2026-11-14T00:00:00.000Z";

function harness({ role = "admin", workspaceId = WORKSPACE_A, subscriptionWorkspace = WORKSPACE_A, initialCancel = false, barrier = null, gateway = "cashfree", provider = "cashfree", authResult = { data: { user: { id: USER_ID } }, error: null } } = {}) {
  const state = { cancel: initialCancel, requestedAt: initialCancel ? "2026-11-13T00:00:00.000Z" : null, updatedAt: null, workspace: subscriptionWorkspace };
  const queryLog = [];
  const createClient = (_url, key) => {
    if (key === "anon-key") return {
      auth: { getUser: async () => authResult },
      from: (table) => ({
        select: () => ({ eq: (column, value) => {
          queryLog.push({ table, column, value });
          return { maybeSingle: async () => ({ data: { workspace_id: workspaceId, role }, error: null }) };
        } }),
      }),
    };
    return {
      from: (table) => ({
        select: () => {
          const filters = {};
          const q = {
            eq(column, value) { filters[column] = value; return this; },
            lte(column, value) { filters[column] = value; return this; }, gt(column, value) { filters[column] = value; return this; }, order() { return this; }, limit() { return this; },
            maybeSingle: async () => {
              queryLog.push({ table, filters: { ...filters } });
              if (filters.workspace_id !== state.workspace || filters.gateway !== gateway || filters.provider !== provider) return { data: null, error: null };
              return { data: { id: "sub-1", expires_at: "2026-12-14T00:00:00Z", cancel_at_period_end: state.cancel, updated_at: state.updatedAt, gateway, provider }, error: null };
            },
          };
          return q;
        },
        update: (values) => {
          const filters = {};
          const q = {
            eq(column, value) { filters[column] = value; return this; },
            lte(column, value) { filters[column] = value; return this; },
            gt(column, value) { filters[column] = value; return this; },
            is(column, value) { filters[column] = value; return this; },
            select() { return this; },
            maybeSingle: async () => {
              if (barrier) await barrier();
              const matches = filters.id === "sub-1" && filters.workspace_id === state.workspace
                && filters.gateway === "cashfree" && filters.provider === "cashfree"
                && filters.status === "active" && filters.started_at === NOW && filters.expires_at === NOW
                && filters.cancel_at_period_end === state.cancel && filters.updated_at === state.updatedAt;
              if (!matches) return { data: null, error: null };
              state.cancel = values.cancel_at_period_end;
              state.requestedAt = values.cancellation_requested_at;
              state.updatedAt = values.updated_at;
              return { data: { id: "sub-1" }, error: null };
            },
          };
          return q;
        },
      }),
    };
  };
  const handler = createManageCashfreeSubscriptionHandler({
    createClient,
    getEnv: (key) => ({ SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key" })[key],
    now: () => new Date(NOW),
  });
  const request = (action) => handler(new Request("https://plivex.in/functions/v1/manage-cashfree-subscription", {
    method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json", Origin: "https://plivex.in" },
    body: JSON.stringify({ action }),
  }));
  return { handler, request, state, queryLog };
}

Deno.test("endpoint schedules cancellation and resumes it with consistent response and state", async () => {
  const h = harness();
  const cancel = await h.request("cancel");
  const cancelBody = await cancel.json();
  if (cancel.status !== 200 || cancelBody.cancelAtPeriodEnd !== true || h.state.cancel !== true) throw new Error("Cancel endpoint response/state mismatch");
  const resume = await h.request("resume");
  const resumeBody = await resume.json();
  if (resume.status !== 200 || resumeBody.cancelAtPeriodEnd !== false || h.state.cancel !== false || h.state.requestedAt !== null) throw new Error("Resume endpoint response/state mismatch");
});

Deno.test("endpoint rejects non-admin users before any subscription lookup", async () => {
  const h = harness({ role: "member" });
  const response = await h.request("cancel");
  if (response.status !== 403 || h.queryLog.some((entry) => entry.table === "subscriptions")) throw new Error("Non-admin reached subscription lookup");
});

Deno.test("endpoint scopes subscription lookup to authenticated workspace", async () => {
  const h = harness({ workspaceId: WORKSPACE_A, subscriptionWorkspace: WORKSPACE_B });
  const response = await h.request("cancel");
  if (response.status !== 404 || h.state.cancel !== false) throw new Error("Cross-workspace subscription was accessible");
  const lookup = h.queryLog.find((entry) => entry.table === "subscriptions");
  if (lookup?.filters?.workspace_id !== WORKSPACE_A) throw new Error("Subscription lookup was not workspace scoped");
});

Deno.test("simultaneous cancel and resume use compare-and-set; exactly one wins", async () => {
  let arrivals = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const barrier = async () => {
    arrivals++;
    if (arrivals === 2) release();
    await gate;
  };
  const h = harness({ initialCancel: false, barrier });
  const [cancel, resume] = await Promise.all([h.request("cancel"), h.request("resume")]);
  const statuses = [cancel.status, resume.status].sort((a, b) => a - b);
  if (statuses[0] !== 200 || statuses[1] !== 409) throw new Error("Expected exactly one successful CAS and one conflict, got " + statuses.join(","));
  const success = cancel.status === 200 ? await cancel.json() : await resume.json();
  if (success.cancelAtPeriodEnd !== h.state.cancel) throw new Error("Successful API response does not match final database state");
});

Deno.test("Cashfree cancellation endpoint never changes an India PayU subscription", async () => {
  const h = harness({ gateway: "payu", provider: "payu" });
  const response = await h.request("cancel");
  if (response.status !== 404 || h.state.cancel !== false || h.state.requestedAt !== null) {
    throw new Error("Cashfree cancellation modified or accepted a PayU subscription");
  }
});

Deno.test("endpoint rejects requests without a bearer token", async () => {
  const h = harness();
  const response = await h.handler(new Request("https://plivex.in/functions/v1/manage-cashfree-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://plivex.in" },
    body: JSON.stringify({ action: "cancel" }),
  }));
  if (response.status !== 401) throw new Error("Missing bearer token was not rejected");
});

Deno.test("endpoint rejects an unapproved browser origin", async () => {
  const h = harness();
  const response = await h.handler(new Request("https://plivex.in/functions/v1/manage-cashfree-subscription", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ action: "cancel" }),
  }));
  if (response.status !== 403) throw new Error("Unapproved origin was not rejected");
});

Deno.test("endpoint rejects non-POST methods", async () => {
  const h = harness();
  const response = await h.handler(new Request("https://plivex.in/functions/v1/manage-cashfree-subscription", {
    method: "GET",
    headers: { Authorization: "Bearer test-token", Origin: "https://plivex.in" },
  }));
  if (response.status !== 405) throw new Error("Non-POST method was not rejected");
});

Deno.test("endpoint rejects unsupported actions without changing subscription state", async () => {
  const h = harness();
  const response = await h.handler(new Request("https://plivex.in/functions/v1/manage-cashfree-subscription", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json", Origin: "https://plivex.in" },
    body: JSON.stringify({ action: "delete" }),
  }));
  if (response.status !== 400 || h.state.cancel !== false || h.state.requestedAt !== null) {
    throw new Error("Unsupported action was accepted or changed subscription state");
  }
});

Deno.test("status action reports current cancellation state without writing", async () => {
  const h = harness({ initialCancel: true });
  const before = { ...h.state };
  const response = await h.request("status");
  const body = await response.json();
  if (response.status !== 200 || body.available !== true || body.cancelAtPeriodEnd !== true) {
    throw new Error("Status action did not report the current subscription state");
  }
  if (h.state.cancel !== before.cancel || h.state.requestedAt !== before.requestedAt || h.state.updatedAt !== before.updatedAt) {
    throw new Error("Status action unexpectedly mutated subscription state");
  }
});


Deno.test("endpoint rejects invalid or expired bearer tokens when auth.getUser returns an error", async () => {
  const h = harness({ authResult: { data: { user: null }, error: { message: "Invalid JWT" } } });
  const response = await h.request("cancel");
  if (response.status !== 401) throw new Error("Invalid or expired bearer token was not rejected");
  if (h.queryLog.length !== 0) throw new Error("Invalid bearer token reached profile or subscription lookup");
  if (h.state.cancel !== false) throw new Error("Invalid bearer token changed subscription state");
});

Deno.test("endpoint rejects a null authenticated user even when auth.getUser has no error", async () => {
  const h = harness({ authResult: { data: { user: null }, error: null } });
  const response = await h.request("cancel");
  if (response.status !== 401) throw new Error("Null authenticated user was not rejected");
  if (h.queryLog.length !== 0) throw new Error("Null authenticated user reached profile or subscription lookup");
  if (h.state.cancel !== false) throw new Error("Null authenticated user changed subscription state");
});
