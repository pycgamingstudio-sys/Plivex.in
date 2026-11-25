import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const cron = read("../../../supabase/functions/sweep-invoice-reminders/index.ts");
const paddle = read("../../../supabase/functions/paddle-webhook/index.ts");
const cashfree = read("../../../supabase/functions/cashfree-webhook/index.ts");
const phonepe = read("../../../supabase/functions/phonepe-webhook/index.ts");
const whatsapp = read("../../../supabase/functions/whatsapp-webhook/index.ts");
const workspaceWhatsapp = read("../../../supabase/functions/workspace-whatsapp-webhook/index.ts");
const invoiceShare = read("../../../supabase/functions/invoice-share/index.ts");
const globalInvoiceShare = read("../../../supabase/functions/global-invoice-share/index.ts");
const globalSupplier = read("../../../supabase/functions/global-supplier-portal/index.ts");
const workspaceSupplier = read("../../../supabase/functions/workspace-supplier-portal/index.ts");
const platform = read("../../../supabase/functions/workspace-platform/index.ts");
const phonepeReturn = read("../../../supabase/functions/phonepe-return/index.ts");
const cashfreeReturn = read("../../../supabase/functions/cashfree-return/index.ts");
const payuReturn = read("../../../supabase/functions/verify-payu-payment/source/index.ts");

test("unauthenticated scheduler endpoint requires a 32+ character secret and constant-time comparison", () => {
  assert.match(cron, /x-cron-secret/);
  assert.match(cron, /supplied\.length < 32/);
  assert.match(cron, /safeEqual\(supplied, config\.secret\)/);
  assert.match(cron, /let difference = 0/);
});

test("payment webhooks verify provider authenticity before applying subscription state", () => {
  assert.match(paddle, /verifyPaddleWebhookSignature/);
  assert.match(paddle, /PADDLE_WEBHOOK_SECRET/);
  assert.match(cashfree, /verifyWebhook\(raw,timestamp,signature\)/);
  assert.match(cashfree, /x-webhook-signature/);
  assert.match(phonepe, /verifyWebhookAuthorization/);
  assert.match(phonepe, /authorization/);
});

test("WhatsApp webhooks verify Meta challenge and HMAC signatures", () => {
  for (const source of [whatsapp, workspaceWhatsapp]) {
    assert.match(source, /x-hub-signature-256/);
    assert.match(source, /HMAC/);
    assert.match(source, /WHATSAPP_APP_SECRET/);
    assert.match(source, /WHATSAPP_VERIFY_TOKEN/);
  }
});

test("public invoice and supplier links use hashed, expiring tokens while management requires auth", () => {
  assert.match(invoiceShare, /token_hash/);
  assert.match(invoiceShare, /expires_at/);
  assert.match(invoiceShare, /auth\.getUser\(\)/);
  assert.match(globalInvoiceShare, /hashToken/);
  assert.match(globalInvoiceShare, /global_resolve_invoice_share/);
  assert.match(globalInvoiceShare, /authenticateGlobal\(req\)/);
  assert.match(globalSupplier, /tokenHash/);
  assert.match(globalSupplier, /global_supplier_portal_read/);
  assert.match(globalSupplier, /authenticateGlobal\(req\)/);
  assert.match(workspaceSupplier, /token_hash/);
  assert.match(workspaceSupplier, /expires_at/);
  assert.match(workspaceSupplier, /client\.auth\.getUser\(\)/);
});

test("non-JWT workspace platform and payment return handlers perform their own verification", () => {
  assert.match(platform, /authClient\.auth\.getUser\(\)/);
  assert.match(phonepeReturn, /checkout\/v2\/order/);
  assert.match(phonepeReturn, /status\?\.state==="COMPLETED"/);
  assert.match(cashfreeReturn, /activatePaidOrder/);
  assert.match(payuReturn, /reverseHash/);
  assert.match(payuReturn, /safeEqualHex/);
});
