import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [migration, rateLimitMigration, endpoint, webhook] = await Promise.all([
  read("../../../supabase/migrations/20261123025844_main_workspace_platform_capabilities.sql"),
  read("../../../supabase/migrations/20261123030605_main_workspace_public_api_rate_limits.sql"),
  read("../../../supabase/functions/workspace-platform/index.ts"),
  read("../../../supabase/functions/workspace-whatsapp-webhook/index.ts"),
]);

test("electronic signature requests bind an issued invoice snapshot and store only token hashes", () => {
  const start = endpoint.indexOf("async function signatureCreate");
  const end = endpoint.indexOf("async function signaturePreview", start);
  const fn = endpoint.slice(start, end);
  assert.match(fn, /canSign\(ctx\.role\)/);
  assert.match(fn, /\.eq\("workspace_id", ctx\.workspaceId\)/);
  assert.match(fn, /document_sha256: documentHash/);
  assert.match(fn, /token_hash: tokenHash/);
  assert.match(fn, /INVOICE_NOT_ISSUED/);
  assert.match(migration, /token_hash text not null unique/);
});

test("signature completion requires explicit consent and records an atomic audit hash", () => {
  const start = endpoint.indexOf("async function signatureComplete");
  const end = endpoint.indexOf("async function processOcr", start);
  const fn = endpoint.slice(start, end);
  assert.match(fn, /body\.consent !== true/);
  assert.match(fn, /p_audit_sha256: auditHash/);
  assert.match(fn, /complete_main_workspace_document_signature/);
  assert.match(migration, /create or replace function public\.complete_main_workspace_document_signature/);
  assert.match(migration, /audit_sha256/);
});

test("WhatsApp sends require opt-in, enforce the customer service window and persist delivery logs", () => {
  const start = endpoint.indexOf("async function whatsappSend");
  const end = endpoint.indexOf("async function apiManagement", start);
  const fn = endpoint.slice(start, end);
  assert.match(fn, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(fn, /WHATSAPP_PHONE_NUMBER_ID/);
  assert.match(fn, /body\.consentConfirmed !== true/);
  assert.match(fn, /WHATSAPP_24_HOUR_WINDOW_REQUIRED/);
  assert.match(fn, /whatsapp_delivery_logs/);
  assert.match(fn, /provider_message_id: providerId/);
  assert.match(migration, /consent_confirmed boolean not null check \(consent_confirmed = true\)/);
});

test("WhatsApp webhook verifies Meta HMAC signatures before updating delivery status", () => {
  assert.match(webhook, /WHATSAPP_APP_SECRET/);
  assert.match(webhook, /x-hub-signature-256/);
  assert.match(webhook, /crypto\.subtle\.sign\("HMAC"/);
  assert.ok(webhook.indexOf("verifySignature(raw") < webhook.indexOf("JSON.parse(raw)"));
  assert.match(webhook, /whatsapp_delivery_logs/);
  assert.match(webhook, /provider_message_id/);
});

test("public API and MCP keys are hashed, revocable, rate-limited and scope constrained", () => {
  const start = endpoint.indexOf("async function apiManagement");
  const end = endpoint.indexOf("async function", start + 20);
  const fn = endpoint.slice(start, end);
  assert.match(fn, /key_hash:keyHash/);
  assert.match(fn, /api_key\.created/);
  assert.match(fn, /api-key\.revoke/);
  assert.match(migration, /key_hash text not null unique/);
  assert.match(rateLimitMigration, /consume_main_workspace_api_rate_limit/);
  assert.match(migration, /mcp\.read/);
});
