import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("recurring invoice schedules are workspace-scoped and service-role only",async()=>{
  const migration=await readFile(new URL("../../../supabase/migrations/20261122204000_global_recurring_invoice_schedules.sql",import.meta.url),"utf8");
  const edge=await readFile(new URL("../../../supabase/functions/global-invoices/index.ts",import.meta.url),"utf8");
  const ui=await readFile(new URL("../../components/global/GlobalInvoicesPanel.jsx",import.meta.url),"utf8");
  assert.match(migration,/alter table global\.recurring_invoice_schedules enable row level security/);
  assert.match(migration,/global\.is_workspace_member\(workspace_id\)/);
  assert.match(migration,/grant execute on function public\.global_create_recurring_invoice_schedule[\s\S]*to service_role/);
  assert.match(migration,/generation_idempotency_key/);
  assert.match(migration,/draft_request_fingerprint/);
  assert.match(migration,/invoice_schedule_mismatch/);
  assert.match(edge,/global_create_recurring_invoice_schedule/);
  assert.match(edge,/global_list_recurring_invoice_schedules/);
  assert.match(edge,/global_advance_recurring_invoice_schedule/);
  assert.match(ui,/Make this a recurring invoice/);
  assert.match(ui,/Generate draft/);
  assert.match(ui,/generation_idempotency_key/);
});

test("recurring invoice schedule creates drafts only and never auto-issues or collects money",async()=>{
  const ui=await readFile(new URL("../../components/global/GlobalInvoicesPanel.jsx",import.meta.url),"utf8");
  assert.match(ui,/reviewable invoice drafts/);
  assert.match(ui,/no payment was collected/);
  assert.match(ui,/action:"create_draft"/);
  assert.doesNotMatch(ui,/action:"issue".*generateRecurringDraft/);
});
