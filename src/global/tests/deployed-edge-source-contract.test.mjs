import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("invoice status changes stop scheduled reminders for paid and cancelled invoices", () => {
  const source = read("../../../supabase/functions/set-invoice-status/index.ts");
  assert.match(source, /status === "Paid" \|\| status === "Cancelled"/);
  assert.match(source, /reminder_enabled: false, reminder_hold: false/);
  assert.match(source, /invoice_reminder_events/);
  assert.match(source, /\.eq\("workspace_id", invoice\.workspace_id\)/);
});

test("invite acceptance verifies identity, plan quota and atomically claims the one-time code", () => {
  const source = read("../../../supabase/functions/verify-invite-code/index.ts");
  assert.match(source, /auth\.user\.email\.toLowerCase\(\) !== String\(invite\.email/);
  assert.match(source, /plan_feature_allowed/);
  assert.match(source, /current_plan/);
  assert.match(source, /PLAN_LIMIT_REACHED/);
  assert.match(source, /\.is\("used_by", null\)\.eq\("used", false\)/);
  assert.match(source, /if \(!claimed\?\.length\)/);
  assert.match(source, /Do not burn a one-time invite/);
  assert.match(source, /profileUpdateError/);
});

test("retired PayU order endpoint fails closed with HTTP 410", () => {
  const source = read("../../../supabase/functions/create-payu-order/index.ts");
  assert.match(source, /PayU checkout has been retired/);
  assert.match(source, /status:410/);
});

test("Cashfree return repository implementation is safer than deployed v11 drift snapshot", () => {
  const source = read("../../../supabase/functions/cashfree-return/index.ts");
  const deployed = read("../../../supabase/functions/cashfree-return/deployed-v11.ts");
  assert.match(source, /PLXCF-\[A-Z0-9\]\{20,30\}/);
  assert.match(source, /safePath\(row\.return_path\)/);
  assert.match(source, /activatePaidOrder\(db,row,providerOrder,payment/);
  assert.match(deployed, /Number\(cash\.order_amount\)\*100!==Number\(row\.amount_paise\)/);
  assert.doesNotMatch(deployed, /PLXCF-\[A-Z0-9\]\{20,30\}/);
  assert.notEqual(source, deployed);
});

test("Cashfree webhook repository implementation handles refunds and out-of-order status safely", () => {
  const source = read("../../../supabase/functions/cashfree-webhook/index.ts");
  const deployed = read("../../../supabase/functions/cashfree-webhook/deployed-v11.ts");
  assert.match(source, /handleCashfreeRefundEvent/);
  assert.match(source, /cashfreePaymentStatusUpdateFilter/);
  assert.match(source, /activatePaidOrder/);
  assert.match(deployed, /PAYMENT_SUCCESS_WEBHOOK/);
  assert.doesNotMatch(deployed, /handleCashfreeRefundEvent/);
  assert.notEqual(source, deployed);
});

test("invoice reminder scheduler uses constant-time cron secret comparison", () => {
  const source = read("../../../supabase/functions/sweep-invoice-reminders/index.ts");
  const deployed = read("../../../supabase/functions/sweep-invoice-reminders/deployed-v12.ts");
  assert.match(source, /const safeEqual = \(left: string, right: string\)/);
  assert.match(source, /!safeEqual\(supplied, config\.secret\)/);
  assert.match(deployed, /supplied !== config\.secret/);
  assert.doesNotMatch(deployed, /const safeEqual/);
});

test("Global business records repository includes barcode, variants and FX expense fields missing from deployed v11", () => {
  const source = read("../../../supabase/functions/global-business-records/index.ts");
  const deployed = read("../../../supabase/functions/global-business-records/deployed-v11.ts");
  for (const field of ["barcode", "variant_of", "variant_label", "transaction_amount_minor", "fx_rate_numerator", "fx_effective_at"]) {
    assert.match(source, new RegExp(field));
    assert.doesNotMatch(deployed, new RegExp(field));
  }
});

test("Global quotations repository binds the tax-aware RPC to the caller JWT", () => {
  const source = read("../../../supabase/functions/global-quotations/index.ts");
  const deployed = read("../../../supabase/functions/global-quotations/deployed-v8.ts");
  assert.match(source, /caller\.rpc\("global_manage_quotation"/);
  assert.match(source, /membershipError/);
  assert.match(source, /membership\)/);
  assert.match(deployed, /auth\.admin\.rpc\("global_manage_quotation"/);
  assert.doesNotMatch(deployed, /caller\.rpc\("global_manage_quotation"/);
});

test("Workspace Platform repository fails closed when active membership cannot be verified", () => {
  const source = read("../../../supabase/functions/workspace-platform/index.ts");
  const deployed = read("../../../supabase/functions/workspace-platform/deployed-v3.ts");
  assert.match(source, /WORKSPACE_MEMBERSHIP_CHECK_FAILED/);
  assert.match(source, /WORKSPACE_MEMBERSHIP_REQUIRED/);
  assert.doesNotMatch(deployed, /WORKSPACE_MEMBERSHIP_REQUIRED/);
});

test("Global Part 4 repository validates integer minor-unit amounts consistently", () => {
  const source = read("../../../supabase/functions/global-part4/index.ts");
  const deployed = read("../../../supabase/functions/global-part4/deployed-v8.ts");
  assert.match(source, /const validMinor/);
  assert.match(source, /validMinor\(values\.unit_cost_minor\)/);
  assert.doesNotMatch(deployed, /const validMinor/);
});
