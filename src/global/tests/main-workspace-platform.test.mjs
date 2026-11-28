import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration=readFileSync(new URL("../../../supabase/migrations/20261123025844_main_workspace_platform_capabilities.sql",import.meta.url),"utf8");
const platform=readFileSync(new URL("../../../supabase/functions/workspace-platform/index.ts",import.meta.url),"utf8");
const webhook=readFileSync(new URL("../../../supabase/functions/workspace-whatsapp-webhook/index.ts",import.meta.url),"utf8");
const page=readFileSync(new URL("../../pages/WorkspacePlatformPage.jsx",import.meta.url),"utf8");
const signing=readFileSync(new URL("../../pages/PublicSignaturePage.jsx",import.meta.url),"utf8");
const app=readFileSync(new URL("../../App.jsx",import.meta.url),"utf8");
const config=readFileSync(new URL("../../../supabase/config.toml",import.meta.url),"utf8");

test("Main Workspace platform tables use canonical public workspace identity and are private",()=>{
  for(const table of ["document_signing_requests","document_ocr_jobs","whatsapp_delivery_logs","public_api_keys","workspace_audit_events"]){
    assert.match(migration,new RegExp("public\\."+table));
    assert.match(migration,new RegExp("alter table public\\."+table+" enable row level security"));
  }
  assert.match(migration,/references public\.workspace_settings\(workspace_id\)/);
  assert.match(migration,/references public\.invoices\(id\)/);
  assert.match(migration,/revoke all on public\.document_signing_requests[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration,/global\./);
});

test("Main Workspace signing is one-time, expiring and atomically audited",()=>{
  assert.match(migration,/complete_main_workspace_document_signature/);
  assert.match(migration,/for update/);
  assert.match(migration,/status = 'signed'/);
  assert.match(migration,/document\.electronically_signed/);
  assert.match(platform,/signature\.create/);
  assert.match(platform,/signature\.preview/);
  assert.match(platform,/signature\.complete/);
  assert.match(signing,/I agree to sign this document electronically/);
  assert.match(app,/path="\/sign\/:token"/);
});

test("OCR uses private storage, Gemini extraction and human review",()=>{
  assert.match(platform,/main-workspace-ocr/);
  assert.match(platform,/GEMINI_API_KEY/);
  assert.match(platform,/requiresHumanReview/);
  assert.match(page,/Document OCR & AI extraction/);
  assert.match(page,/files\.length>10/);
});

test("WhatsApp sends require opt-in and webhook verifies Meta HMAC",()=>{
  assert.match(platform,/WHATSAPP_ACCESS_TOKEN/);
  assert.match(platform,/WHATSAPP_PHONE_NUMBER_ID/);
  assert.match(platform,/WHATSAPP_24_HOUR_WINDOW_REQUIRED/);
  assert.match(platform,/consent_confirmed: true/);
  assert.match(webhook,/x-hub-signature-256/);
  assert.match(webhook,/WHATSAPP_APP_SECRET/);
  assert.match(webhook,/WHATSAPP_VERIFY_TOKEN/);
  assert.match(page,/Customer has explicitly opted in/);
  assert.match(page,/Recent delivery statuses/);
});

test("Public API keys are hashed, scoped, expiring and revocable with MCP read tools",()=>{
  assert.match(migration,/key_hash text not null unique/);
  assert.match(platform,/x-plivex-key/);
  assert.match(platform,/key_hash:keyHash/);
  assert.match(platform,/api-key\.revoke/);
  assert.match(platform,/consume_main_workspace_api_rate_limit/);
  assert.match(platform,/signature\.revoke/);
  assert.match(platform,/mcp\.tools\/list/);
  assert.match(platform,/business_insights/);
  assert.match(page,/Public API & MCP access/);
});

test("Main Workspace CRM and multi-warehouse foundations remain the active public-schema implementation",()=>{
  const crm=readFileSync(new URL("../../../supabase/migrations/202611160003_india_part4_warehouse_crm_purchase.sql",import.meta.url),"utf8");
  const warehouse=readFileSync(new URL("../../../supabase/migrations/202611160004_india_part4_transactional_rpcs.sql",import.meta.url),"utf8");
  const crmUi=readFileSync(new URL("../../components/dashboard/CrmTab.jsx",import.meta.url),"utf8");
  const warehouseUi=readFileSync(new URL("../../components/dashboard/IndiaPart4Tab.jsx",import.meta.url),"utf8");
  assert.match(crm,/create table if not exists public\.lead_activities/);
  assert.match(crm,/public\.leads/);
  assert.match(crmUi,/STAGES/);
  assert.match(warehouse,/create table if not exists public\.stock_transfers/);
  assert.match(warehouse,/india_part4_transfer_stock/);
  assert.match(warehouseUi,/india_part4_create_purchase_order/);
});

const enterpriseMigration=readFileSync(new URL("../../../supabase/migrations/20261123031111_main_workspace_approvals_and_permission_delegation.sql",import.meta.url),"utf8");
const enterpriseControls=readFileSync(new URL("../../components/workspace/WorkspaceEnterpriseControls.jsx",import.meta.url),"utf8");
const enterpriseFixes=readFileSync(new URL("../../../supabase/migrations/20261123031227_main_workspace_approval_lists_permission_overrides.sql",import.meta.url),"utf8");

test("Main Workspace approvals are sequential, self-approval protected and escalated by cron",()=>{
  assert.match(enterpriseMigration,/workspace_approval_policies/);
  assert.match(enterpriseMigration,/workspace_approval_requests/);
  assert.match(enterpriseMigration,/workspace_approval_steps/);
  assert.match(enterpriseMigration,/self_approval_blocked/);
  assert.match(enterpriseMigration,/main_workspace_escalate_overdue_approvals/);
  assert.match(enterpriseMigration,/\*\/5 \* \* \* \*/);
  assert.match(enterpriseFixes,/main_workspace_list_approval_requests/);
  assert.match(enterpriseControls,/Multi-level approvals/);
  assert.match(enterpriseControls,/main_workspace_decide_approval/);
});

test("Main Workspace permission delegations and overrides are time-bounded and audited",()=>{
  assert.match(enterpriseMigration,/workspace_permission_delegations/);
  assert.match(enterpriseMigration,/90 days/);
  assert.match(enterpriseMigration,/permission\.delegation\.created/);
  assert.match(enterpriseMigration,/permission\.delegation\.revoked/);
  assert.match(enterpriseFixes,/main_workspace_permission_override_set/);
  assert.match(enterpriseFixes,/main_workspace_has_permission/);
  assert.match(enterpriseControls,/Enterprise permissions & delegation/);
  assert.match(enterpriseControls,/main_workspace_permission_delegation_create/);
});

const recurringMigration=readFileSync(new URL("../../../supabase/migrations/20261123031536_main_workspace_recurring_invoice_schedules.sql",import.meta.url),"utf8");
const recurringGuard=readFileSync(new URL("../../../supabase/migrations/20261123031712_main_workspace_recurring_invoice_country_guard.sql",import.meta.url),"utf8");
const recurringUi=readFileSync(new URL("../../components/workspace/WorkspaceRecurringInvoices.jsx",import.meta.url),"utf8");

test("Main Workspace recurring invoices generate idempotent review-only drafts",()=>{
  assert.match(recurringMigration,/recurring_invoice_generations/);
  assert.match(recurringMigration,/unique\(schedule_id,occurrence_date\)/);
  assert.match(recurringMigration,/main_workspace_generate_recurring_invoice_drafts/);
  assert.match(recurringMigration,/'Draft',true/);
  assert.match(recurringMigration,/cron\.schedule/);
  assert.match(recurringGuard,/schedule_paused_country_changed/);
  assert.match(recurringGuard,/source_country_code/);
  assert.match(recurringUi,/Recurring invoices/);
  assert.match(recurringUi,/main_workspace_create_recurring_invoice_schedule/);
  assert.match(recurringUi,/main_workspace_recurring_schedule_set_status/);
});

const salesDocsMigration=readFileSync(new URL("../../../supabase/migrations/20261123031922_main_workspace_sales_document_workflows.sql",import.meta.url),"utf8");
const salesDocsManagement=readFileSync(new URL("../../../supabase/migrations/20261123032023_main_workspace_sales_documents_management.sql",import.meta.url),"utf8");
const salesDocsUi=readFileSync(new URL("../../components/workspace/WorkspaceSalesDocuments.jsx",import.meta.url),"utf8");

test("Main Workspace sales orders, delivery challans and credit/debit notes are transactional and audited",()=>{
  assert.match(salesDocsMigration,/main_workspace_create_sales_order/);
  assert.match(salesDocsMigration,/main_workspace_create_delivery_challan/);
  assert.match(salesDocsMigration,/main_workspace_create_credit_debit_note/);
  assert.match(salesDocsMigration,/credit_exceeds_remaining_invoice_total/);
  assert.match(salesDocsMigration,/idempotency_key/);
  assert.match(salesDocsManagement,/main_workspace_list_sales_documents/);
  assert.match(salesDocsManagement,/delivered_quantity/);
  assert.match(salesDocsUi,/Sales orders/);
  assert.match(salesDocsUi,/Delivery challans/);
  assert.match(salesDocsUi,/Credit & debit notes/);
});

const supplierMigration=readFileSync(new URL("../../../supabase/migrations/20261123032231_main_workspace_supplier_onboarding_portal.sql",import.meta.url),"utf8");
const supplierAtomic=readFileSync(new URL("../../../supabase/migrations/20261123032328_main_workspace_supplier_portal_atomic_submit.sql",import.meta.url),"utf8");
const supplierFn=readFileSync(new URL("../../../supabase/functions/workspace-supplier-portal/index.ts",import.meta.url),"utf8");
const supplierUi=readFileSync(new URL("../../components/workspace/WorkspaceSupplierPortal.jsx",import.meta.url),"utf8");
const supplierPage=readFileSync(new URL("../../pages/PublicSupplierOnboardingPage.jsx",import.meta.url),"utf8");

test("Main Workspace supplier onboarding uses expiring single-use invitations and atomic country-checked submission",()=>{
  assert.match(supplierMigration,/supplier_invitation_tokens/);
  assert.match(supplierMigration,/token_hash text not null unique/);
  assert.match(supplierMigration,/supplier_one_active_invite_idx/);
  assert.match(supplierAtomic,/for update/);
  assert.match(supplierAtomic,/tax_country_mismatch/);
  assert.match(supplierAtomic,/supplier\.profile_submitted/);
  assert.match(supplierFn,/BREVO_API_KEY/);
  assert.match(supplierFn,/RESEND_API_KEY/);
  assert.match(supplierFn,/supplier_invitation_tokens/);
  assert.match(supplierUi,/Supplier onboarding portal/);
  assert.match(supplierPage,/Complete supplier profile/);
  assert.match(app,/path="\/supplier-onboarding\/:token"/);
});

const serialMigration=readFileSync(new URL("../../../supabase/migrations/20261123032619_main_workspace_inventory_serial_traceability.sql",import.meta.url),"utf8");
const serialUi=readFileSync(new URL("../../components/workspace/WorkspaceSerialTraceability.jsx",import.meta.url),"utf8");

test("Main Workspace serial traceability validates warehouse ownership and audits lifecycle transitions",()=>{
  assert.match(serialMigration,/inventory_serial_units/);
  assert.match(serialMigration,/inventory_serial_events/);
  assert.match(serialMigration,/serial_number_already_registered/);
  assert.match(serialMigration,/invalid_serial_transition/);
  assert.match(serialMigration,/issued_invoice_required/);
  assert.match(serialMigration,/workspace_id=p_workspace_id/);
  assert.match(serialUi,/Serial-number traceability/);
  assert.match(serialUi,/main_workspace_register_inventory_serials/);
  assert.match(serialUi,/main_workspace_update_inventory_serial/);
  assert.match(serialUi,/does not change aggregate stock quantity/);
});

const biMigration=readFileSync(new URL("../../../supabase/migrations/20261123032824_main_workspace_custom_bi_and_cashflow_analytics.sql",import.meta.url),"utf8");
const biUi=readFileSync(new URL("../../components/workspace/WorkspaceAnalyticsPanel.jsx",import.meta.url),"utf8");

test("Main Workspace custom BI reports and currency-safe cashflow/sales analytics are available",()=>{
  assert.match(biMigration,/workspace_custom_reports/);
  assert.match(biMigration,/main_workspace_cashflow_forecast/);
  assert.match(biMigration,/main_workspace_sales_analytics/);
  assert.match(biMigration,/currency/);
  assert.match(biMigration,/partial receipts are not netted/);
  assert.match(biUi,/Business intelligence & cash-flow analytics/);
  assert.match(biUi,/Save report/);
  assert.match(biUi,/3-month cash-flow forecast/);
  assert.match(biUi,/Six-month sales analytics/);
});

const bankMigration=readFileSync(new URL("../../../supabase/migrations/20261123033111_main_workspace_bank_accounting_and_fx.sql",import.meta.url),"utf8");
const bankLists=readFileSync(new URL("../../../supabase/migrations/20261123033131_main_workspace_accounting_list_rpcs.sql",import.meta.url),"utf8");
const bankFx=readFileSync(new URL("../../../supabase/migrations/20261123033153_main_workspace_bank_fx_reconciliation_fixes.sql",import.meta.url),"utf8");
const bankHardening=readFileSync(new URL("../../../supabase/migrations/20261123033332_main_workspace_bank_fx_matching_hardening.sql",import.meta.url),"utf8");
const bankUi=readFileSync(new URL("../../components/workspace/WorkspaceBankAccounting.jsx",import.meta.url),"utf8");

test("Main Workspace bank imports, matching and statement reconciliation are private and auditable",()=>{
  assert.match(bankMigration,/bank_statement_imports/);
  assert.match(bankMigration,/main_workspace_import_bank_statement/);
  assert.match(bankMigration,/Customer receipt/);
  assert.match(bankMigration,/main_workspace_reconcile_bank_import/);
  assert.match(bankHardening,/v_candidates=1/);
  assert.match(bankUi,/CSV import only/);
  assert.match(bankUi,/Confirm match/);
  assert.match(bankUi,/does not automatically mark an invoice paid/);
});

test("Main Workspace journals enforce balanced double-entry and FX snapshots stay dated",()=>{
  assert.match(bankMigration,/journal_not_balanced/);
  assert.match(bankMigration,/main_workspace_post_journal_entry/);
  assert.match(bankMigration,/workspace_fx_rates/);
  assert.match(bankFx,/main_workspace_convert_amount/);
  assert.match(bankFx,/main_workspace_fx_reconciliation/);
  assert.match(bankUi,/Double-entry accounting/);
  assert.match(bankUi,/FX rates & reconciliation/);
  assert.match(bankUi,/Manual, dated FX snapshots/);
  assert.match(bankLists,/main_workspace_list_bank_data/);
});

const gstMigration=readFileSync(new URL("../../../supabase/migrations/20261123033733_main_workspace_gst_return_preparation.sql",import.meta.url),"utf8");
const gstHardening=readFileSync(new URL("../../../supabase/migrations/20261123033803_main_workspace_gst_return_hardening.sql",import.meta.url),"utf8");
const gstUi=readFileSync(new URL("../../components/workspace/WorkspaceGSTCompliance.jsx",import.meta.url),"utf8");

test("Main Workspace GST return preparation is India-only, auditable and never claims GSTN submission",()=>{
  assert.match(gstMigration,/india_workspace_required/);
  assert.match(gstMigration,/main_workspace_prepare_gstr1_draft/);
  assert.match(gstMigration,/main_workspace_import_gstr2b/);
  assert.match(gstMigration,/main_workspace_match_gstr2b_line/);
  assert.match(gstMigration,/main_workspace_compute_gstr3b/);
  assert.match(gstMigration,/main_workspace_generate_gst_calendar/);
  assert.match(gstHardening,/main_workspace_mark_gstr1_exported/);
  assert.match(gstUi,/does not connect to GSTN or file returns/);
  assert.match(gstUi,/GSTR-1/);
  assert.match(gstUi,/GSTR-2B/);
  assert.match(gstUi,/GSTR-3B/);
});

test("All country routes use the single Main Workspace and do not load the retired Global application",()=>{
  assert.doesNotMatch(app,/GlobalApp/);
  assert.doesNotMatch(app,/GlobalCountryOnboarding/);
  assert.doesNotMatch(app,/isGlobalWorkspace/);
  assert.match(app,/All supported countries use the same Main Workspace routes/);
  assert.match(app,/path="\/platform"/);
});

const crmUi=readFileSync(new URL("../../components/workspace/WorkspaceCRMPanel.jsx",import.meta.url),"utf8");

test("Main Workspace CRM persists clients, leads, stages and follow-up activity in Supabase",()=>{
  assert.match(crmUi,/supabase\.from\("clients"\)/);
  assert.match(crmUi,/supabase\.from\("leads"\)/);
  assert.match(crmUi,/supabase\.from\("lead_activities"\)/);
  assert.match(crmUi,/Lead pipeline/);
  assert.match(crmUi,/Upcoming & overdue follow-ups/);
  assert.match(crmUi,/Activity timeline/);
  assert.match(crmUi,/main_workspace_complete_lead_activity/);
  assert.match(app,/WorkspaceCRMPanel initialTab="leads"/);
  assert.match(app,/WorkspaceCRMPanel initialTab="clients"/);
  assert.doesNotMatch(app,/CrmTab/);
});

test("Main Workspace platform fails closed when active workspace membership cannot be verified",()=>{
  assert.match(platform,/WORKSPACE_MEMBERSHIP_CHECK_FAILED/);
  assert.match(platform,/WORKSPACE_MEMBERSHIP_REQUIRED/);
  assert.doesNotMatch(platform,/membership\?\.role \|\| profile\.role/);
  assert.match(platform,/const role = String\(membership\.role \|\| ""\)/);
});

test("Main Workspace API scopes are runtime-filtered and digest inputs use an owned ArrayBuffer",()=>{
  assert.match(platform,/scopeValues: unknown\[\]/);
  assert.match(platform,/new Set<string>/);
  assert.match(platform,/input\.buffer as ArrayBuffer/);
  assert.match(platform,/async function publicApi\([\s\S]*?Promise<any>/);
  assert.match(platform,/error: keyError/);
  assert.match(platform,/API_READ_FAILED/);
  assert.match(platform,/readPublicApiPage/);
});
