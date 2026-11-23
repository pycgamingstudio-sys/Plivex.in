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
  assert.match(salesDocsManagement,/challan_quantity/);
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
