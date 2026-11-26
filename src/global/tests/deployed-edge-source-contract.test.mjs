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
