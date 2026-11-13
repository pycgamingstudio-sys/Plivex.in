import { createManageCashfreeSubscriptionHandler } from "./handler.mjs";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";
const NOW = "2026-11-14T00:00:00.000Z";

function harness({ role = "admin", workspaceId = WORKSPACE_A, subscriptionWorkspace = WORKSPACE_A, initialCancel = false, barrier = null } = {}) {
  const state = { cancel: initialCancel, requestedAt: initialCancel ? "2026-11-13T00:00:00.000Z" : null, workspace: subscriptionWorkspace };
  const queryLog = [];
  const createClient = (_url, key) => {
    if (key === "anon-key") return {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
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
            lte() { return this; }, gt() { return this; }, order() { return this; }, limit() { return this; },
            maybeSingle: async () => {
              queryLog.push({ table, filters: { ...filters } });
              if (filters.workspace_id !== state.workspace || filters.gateway !== "cashfree" || filters.provider !== "cashfree") return { data: null, error: null };
              return { data: { id: "sub-1", expires_at: "2026-12-14T00:00:00Z", cancel_at_period_end: state.cancel, gateway: "cashfree", provider: "cashfree" }, error: null };
            },
          };
          return q;
        },
        update: (values) => {
          const filters = {};
          const q = {
            eq(column, value) { filters[column] = value; return this; },
            is(column, value) { filters[column] = value; return this; },
            select() { return this; },
            maybeSingle: async () => {
              if (barrier) await barrier();
              const matches = filters.id === "sub-1" && filters.workspace_id === state.workspace
                && filters.gateway === "cashfree" && filters.provider === "cashfree"
                && filters.status === "active" && filters.cancel_at_period_end === state.cancel;
              if (!matches) return { data: null, error: null };
              state.cancel = values.cancel_at_period_end;
              state.requestedAt = values.cancellation_requested_at;
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
