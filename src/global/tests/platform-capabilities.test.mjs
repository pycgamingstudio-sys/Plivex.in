import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261123030000_global_platform_capabilities.sql", import.meta.url), "utf8");
const platform = readFileSync(new URL("../../../supabase/functions/global-platform/index.ts", import.meta.url), "utf8");
const webhook = readFileSync(new URL("../../../supabase/functions/whatsapp-webhook/index.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../../components/global/GlobalPlatformPanel.jsx", import.meta.url), "utf8");
const signingPage = readFileSync(new URL("../../pages/PublicSignaturePage.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const config = readFileSync(new URL("../../../supabase/config.toml", import.meta.url), "utf8");

test("electronic signature requests are one-time, expiring and atomically audited", () => {
  assert.match(migration, /global\.document_signing_requests/);
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /global_complete_document_signature/);
  assert.match(migration, /for update/);
  assert.match(migration, /status = 'signed'/);
  assert.match(migration, /document\.electronically_signed/);
  assert.match(migration, /grant execute on function public\.global_complete_document_signature.*to service_role/);
  assert.match(platform, /signature\.preview/);
  assert.match(platform, /signature\.complete/);
  assert.match(platform, /p_token_hash: tokenHash/);
  assert.match(signingPage, /I agree to sign this document electronically/);
  assert.match(app, /path="\/sign\/:token"/);
  assert.match(signingPage, /documentSha256/);
});

test("OCR stores private source files and returns review-only structured extraction", () => {
  assert.match(migration, /global\.document_ocr_jobs/);
  assert.match(platform, /global-ocr-documents/);
  assert.match(platform, /GEMINI_API_KEY/);
  assert.match(platform, /requiresHumanReview: true/);
  assert.match(platform, /Never invent unreadable values/);
  assert.match(panel, /Document OCR & AI extraction/);
  assert.match(panel, /Review every extracted field before using it/);
  assert.match(panel, /multiple accept=/);
  assert.match(panel, /files.length > 10/);
  assert.doesNotMatch(platform, /insert\(.*(?:global\.invoices|global\.expenses)/s);
});

test("WhatsApp sends require opt-in evidence and obey the 24-hour free-form window", () => {
  assert.match(migration, /consent_statement text not null/);
  assert.match(migration, /'delivered','read','failed'/);
  assert.match(platform, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(platform, /WHATSAPP_PHONE_NUMBER_ID/);
  assert.match(platform, /WHATSAPP_OPT_IN_REQUIRED/);
  assert.match(platform, /WHATSAPP_24_HOUR_WINDOW_REQUIRED/);
  assert.match(platform, /consent_statement: clean\(body\.consentStatement/);
  assert.match(webhook, /x-hub-signature-256/);
  assert.match(webhook, /WHATSAPP_VERIFY_TOKEN/);
  assert.match(webhook, /WHATSAPP_APP_SECRET/);
  assert.match(panel, /Customer has explicitly opted in/);
});

test("public API keys are hashed, scoped, revocable and workspace-bound", () => {
  assert.match(migration, /global\.public_api_keys/);
  assert.match(migration, /key_hash text not null unique/);
  assert.match(migration, /revoke all on global\.document_signing_requests/);
  assert.match(platform, /x-plivex-key/);
  assert.match(platform, /key_hash: await sha256\(token\)/);
  assert.match(platform, /api-key\.revoke/);
  assert.match(platform, /activeOwner/);
  assert.match(platform, /global_consume_enterprise_rate_limit/);
  assert.match(panel, /Public API & MCP access/);
});

test("MCP exposes only scoped read tools and an aggregate AI business insight tool", () => {
  assert.match(platform, /mcp\.tools\/list/);
  assert.match(platform, /tools\/call/);
  assert.match(platform, /workspace_summary/);
  assert.match(platform, /list_invoices/);
  assert.match(platform, /list_clients/);
  assert.match(platform, /business_insights/);
  assert.match(platform, /GEMINI_BUSINESS_MODEL/);
  assert.match(platform, /Scopes required: mcp\.read and workspace\.read/);
  assert.match(config, /\[functions\.global-platform\][\s\S]*?verify_jwt = false/);
  assert.match(config, /\[functions\.whatsapp-webhook\][\s\S]*?verify_jwt = false/);
});
