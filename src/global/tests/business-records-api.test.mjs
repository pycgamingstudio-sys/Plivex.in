import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [backend, handler, shared, rpc, settings, businessProfile, resetRpc, resetHandler, authContext] = await Promise.all([
  read("../../api/backendClient.js"),
  read("../../../supabase/functions/global-business-records/index.ts"),
  read("../../../supabase/functions/_shared/global.ts"),
  read("../../../supabase/migrations/202611150005_global_business_profile_records.sql"),
  read("../../components/global/WorkspaceCountrySettings.jsx"),
  read("../../pages/BusinessProfile.jsx"),
  read("../../../supabase/migrations/20261115190000_self_service_country_reset.sql"),
  read("../../../supabase/functions/reset-workspace-country/index.ts"),
  read("../../lib/AuthContext.jsx"),
]);

test("Global app can invoke only the dedicated Global business records function", () => {
  assert.match(backend, /!\["global-ensure-owner", "global-business-records", "global-invoices", "global-stock-movements", "global-update-workspace-country", "reset-workspace-country"\]\.includes\(functionName\)/);
  assert.match(backend, /"global-business-records", "global-invoices", "global-stock-movements", "workspace-records"/);
  assert.match(handler, /\.rpc\("global_business_records"/);
});

test("Global records API verifies the bearer user and RPC rechecks active workspace membership", () => {
  assert.match(shared, /authClient\.auth\.getUser\(\)/);
  assert.match(handler, /p_user_id: auth\.user\.id/);
  assert.match(rpc, /from global\.workspace_members wm/);
  assert.match(rpc, /wm\.status = 'active'/);
  assert.match(rpc, /reason', 'access_denied'/);
});

test("Global record writes are allowlisted, workspace-scoped and role-scoped", () => {
  assert.match(handler, /const TABLE_FIELDS/);
  assert.match(handler, /READ_ONLY_TABLES/);
  assert.match(rpc, /created_by/);
  assert.match(rpc, /where id=p_record_id and workspace_id=p_workspace_id/);
  assert.match(rpc, /v_role not in \('owner','admin','manager'\)/);
  assert.doesNotMatch(handler, /\.from\("(?:profiles|clients|products|expenses)"\)/);
});

test("Global records reject invalid amounts, currencies, fields, and oversized bodies", () => {
  assert.match(handler, /Number\.isSafeInteger/);
  assert.match(handler, /One or more fields are not supported/);
  assert.match(handler, /MAX_BODY_BYTES/);
  assert.match(rpc, /reason', 'invalid_currency'/);
});

test("Global records never expose the private Global schema or fall back to India tables", () => {
  assert.doesNotMatch(handler, /\.schema\("global"\)|\.schema\("public"\)|workspace-records/);
  assert.match(rpc, /revoke all on function public\.global_business_records.*from public, anon, authenticated/s);
  assert.match(rpc, /grant execute on function public\.global_business_records.*to service_role/s);
  assert.doesNotMatch(handler, /\.from\("profiles"\)/);
});


test("Global workspace profile reads and updates stay inside global.business_profiles", () => {
  assert.match(backend, /function invokeGlobalWorkspaceRecords/);
  assert.match(backend, /functionName === "workspace-records"/);
  assert.match(handler, /business_profiles: \[/);
  assert.match(handler, /Global business profile supports read and update only/);
  assert.match(rpc, /from global\.business_profiles where workspace_id=p_workspace_id/);
  assert.match(rpc, /update global\.business_profiles set/);
  assert.match(rpc, /v_role not in \('owner','admin'\)/);
});


test("Global business tax profile stores the effective registration date in the private schema", () => {
  assert.match(handler, /tax_registration_effective_from/);
  assert.match(rpc, /add column if not exists tax_registration_effective_from date/);
  assert.match(rpc, /tax_registration_effective_from=case/);
  assert.match(backend, /tax_registration_effective_from/);
  assert.doesNotMatch(backend, /if \(values\.gstin\) profile\.tax_registration_number/);
});


test("Country changes require explicit confirmation while locale-only edits preserve the workspace", () => {
  assert.match(settings, /showResetConfirm/);
  assert.match(settings, /Type DELETE to confirm/);
  assert.match(settings, /Confirm & permanently delete/);
  assert.match(settings, /resetWorkspaceCountry/);
  assert.match(settings, /globalUpdateWorkspaceCountry/);
  assert.doesNotMatch(settings, /request_workspace_country_change/);
  assert.match(businessProfile, /WorkspaceCountrySettings lockCountry=\{APP_EDITION === "global"\}/);
});

test("Country reset is authenticated, owner-scoped, cooldown-limited and atomic", () => {
  assert.match(resetHandler, /authenticate\(req\)/);
  assert.match(resetHandler, /confirmationPhrase !== "DELETE_MY_BUSINESS_DATA"/);
  assert.match(resetHandler, /reset_workspace_country_atomic/);
  assert.match(resetRpc, /pg_advisory_xact_lock/);
  assert.match(resetRpc, /interval '30 days'/);
  assert.match(resetRpc, /workspace_owner_required/);
  assert.match(resetRpc, /update public\.subscriptions/);
  assert.match(resetRpc, /update public\.payment_logs/);
  assert.match(resetRpc, /private\.country_reset_events/);
  assert.match(resetRpc, /revoke all on function public\.reset_workspace_country_atomic.*from public, anon, authenticated/s);
  assert.match(resetRpc, /grant execute on function public\.reset_workspace_country_atomic.*to service_role/s);
  assert.match(authContext, /const profileCountry = currentUser\?\.country_code/);
  assert.match(authContext, /profileCountry.*metadataCountry/s);
});
