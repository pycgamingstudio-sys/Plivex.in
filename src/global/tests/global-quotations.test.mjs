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
  assert.match(edge, /Number\.isSafeInteger\(item\.unit_price_minor\)/);
  assert.match(edge, /quotation_id/);
});

test("Global quotations are selectable in More Features and remain separate from invoice navigation", async () => {
  const features = await read("../../lib/workspaceFeatures.js");
  const layout = await read("../../components/AppLayout.jsx");
  const app = await read("../../App.jsx");
  const global = await read("../GlobalApp.jsx");
  const panel = await read("../../components/global/GlobalQuotationsPanel.jsx");
  assert.match(features, /id: "quotations"/);
  assert.match(layout, /to: "\/quotations", label: "Quotations"/);
  assert.match(layout, /workspaceFeatures\.includes\("quotations"\)/);
  assert.match(app, /path="\/quotations".*GlobalApp section="quotations"/);
  assert.match(global, /GlobalQuotationsPanel account=\{account\}/);
  assert.match(panel, /Save quotation draft/);
  assert.match(panel, /Convert to invoice draft/);
  assert.match(panel, /Download PDF/);
  assert.match(panel, /not an invoice or tax invoice/i);
});

test("quotation totals and statuses cannot create payment or tax side effects", async () => {
  const migration = await read("../../../supabase/migrations/20261117170000_global_quotations_workflow.sql");
  const panel = await read("../../components/global/GlobalQuotationsPanel.jsx");
  assert.match(migration, /if v_quote\.status<>'accepted' then/);
  assert.match(migration, /'Converted from quotation '/);
  assert.match(panel, /Taxes are not calculated or assessed by Plivex/);
  assert.match(panel, /cannot accept payments/);
  assert.match(panel, /action: "convert"/);
});

test("mobile onboarding keeps progress, step content and actions within the phone viewport", async () => {
  const onboarding = await read("../../components/global/UnifiedWorkspaceOnboarding.jsx");
  assert.match(onboarding, /min-h-\[100dvh\].*px-3/);
  assert.match(onboarding, /w-full max-w-3xl/);
  assert.match(onboarding, /flex min-h-\[min\(780px,calc\(100dvh-2\.5rem\)\)\] w-full/);
  assert.match(onboarding, /flex-1 overflow-y-auto overscroll-contain/);
  assert.match(onboarding, /shrink-0 items-center justify-between.*safe-area-inset-bottom/);
  assert.match(onboarding, /min-h-11/);
  assert.match(onboarding, /Skip mobile number/);
});
