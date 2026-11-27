import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Global quotations use a separate workspace-scoped document model", async () => {
  const migration = await read("../../../supabase/migrations/20261117170000_global_quotations_workflow.sql");
  assert.match(migration, /create table if not exists global\.quotations/);
  assert.match(migration, /create table if not exists global\.quotation_items/);
  assert.match(migration, /workspace_id uuid not null/);
  assert.match(migration, /status in \('draft','sent','accepted','rejected','expired','converted'\)/);
  assert.match(migration, /alter table global\.quotations enable row level security/);
  assert.match(migration, /revoke all on global.quotations, global.quotation_items from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.global_manage_quotation[\s\S]*to service_role/);
  assert.match(migration, /public\.global_create_invoice_draft\(/);
  assert.doesNotMatch(migration, /global_record_invoice_payment|global_record_invoice_refund/);
});

test("Global quotation API requires an authenticated workspace and validates line items", async () => {
  const edge = await read("../../../supabase/functions/global-quotations/index.ts");
  assert.match(edge, /authenticateGlobal\(req\)/);
  assert.match(edge, /body\.workspace_id/);
  assert.match(edge, /p_user_id: auth\.user\.id/);
  assert.match(edge, /p_workspace_id: body\.workspace_id/);
  assert.match(edge, /global_manage_quotation/);
  assert.match(edge, /auth\.admin\.rpc\("global_manage_quotation"/);
  assert.doesNotMatch(edge, /caller\.rpc\("global_manage_quotation"/);
  assert.match(edge, /from\("workspace_members"\)[\s\S]*?eq\("user_id", auth\.user\.id\)[\s\S]*?eq\("status", "active"\)/);
  assert.doesNotMatch(edge, /createClient\(supabaseUrl, supabaseAnonKey/);
  assert.match(edge, /Number\.isSafeInteger\(item\.unit_price_minor\)/);
  assert.match(edge, /quotation_id/);
});

test("quotations are reachable from the shared Main Workspace sales module", async () => {
  const app = await read("../../App.jsx");
  const sales = await read("../../components/dashboard/SalesTab.jsx");
  const dashboard = await read("../../pages/Dashboard.jsx");
  assert.ok(app.includes('path="/quotations" element={<Navigate to="/dashboard" replace state={{ initialTab: "sales", initialSub: "quotations" }} />}'));
  assert.match(dashboard, /initialSub=\{initialSub\}/);
  assert.match(sales, /initialSub === "quotations" \? "quotations" : "invoices"/);
  assert.doesNotMatch(app, /GlobalApp|isGlobalWorkspace/);
});

test("quotation totals and statuses cannot create payment or tax side effects", async () => {
  const migration = await read("../../../supabase/migrations/20261117170000_global_quotations_workflow.sql");
  const panel = await read("../../components/global/GlobalQuotationsPanel.jsx");
  assert.match(migration, /if v_quote\.status<>'accepted' then/);
  assert.match(migration, /'Converted from quotation '/);
  assert.match(panel, /tax_minor/);
  assert.match(panel, /total_including_tax_minor/);
  assert.match(panel, /tax_snapshot/);
  assert.match(panel, /workspace country/i);
  assert.match(panel, /cannot accept payments/);
  assert.match(panel, /action: "convert"/);
});

test("mobile onboarding keeps progress, step content and actions within the phone viewport", async () => {
  const onboarding = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  assert.match(onboarding, /h-\[100dvh\].*px-3/);
  assert.match(onboarding, /w-full max-w-3xl/);
  assert.match(onboarding, /h-auto min-h-\[calc\(100dvh-1\.5rem\)\] w-full/);
  assert.match(onboarding, /overflow-y-auto overscroll-y-contain/);
  assert.match(onboarding, /overflow-visible.*sm:overflow-y-auto/);
  assert.match(onboarding, /shrink-0 items-center justify-between.*safe-area-inset-bottom/);
  assert.match(onboarding, /min-h-11/);
  assert.match(onboarding, /Skip mobile number/);
});
