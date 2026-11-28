import test from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATION_CATALOG,
  INTEGRATION_STATUSES,
  getIntegrationDefinition,
  getIntegrationStatusLabel,
  getWebhookRetryDelaySeconds,
  isLiveVerified,
  normalizeIntegrationStatus,
  validateWebhookEndpoint,
  validateWebhookEventTypes,
  WORKSPACE_EVENT_TYPES,
} from "../integrations/integration-registry.js";

test("integration registry contains only the agreed provider identifiers", () => {
  assert.deepEqual(INTEGRATION_CATALOG.map((item) => item.key), [
    "shopify", "whatsapp_cloud", "cashfree", "paddle", "public_api", "custom_webhooks",
  ]);
  assert.equal(getIntegrationDefinition("shopify").label, "Shopify");
  assert.equal(getIntegrationDefinition("unknown"), null);
});

test("integration statuses are explicit and unknown values never appear live", () => {
  assert.deepEqual(INTEGRATION_STATUSES, [
    "available", "setup_required", "awaiting_provider_access", "sandbox_tested", "live_verified",
  ]);
  assert.equal(normalizeIntegrationStatus("made_up"), "setup_required");
  assert.equal(getIntegrationStatusLabel("sandbox_tested"), "Sandbox tested");
  assert.equal(isLiveVerified({ status: "live_verified" }), false);
  assert.equal(isLiveVerified({ status: "live_verified", verified_at: "2099-01-01T00:00:00Z" }), false);
  assert.equal(isLiveVerified({ status: "live_verified", verified_at: "2026-01-01T00:00:00Z" }), true);
});

test("webhook subscriptions accept only unique, allow-listed event types", () => {
  assert.equal(validateWebhookEventTypes(["invoice.created", "stock.low_stock"]), true);
  assert.equal(validateWebhookEventTypes(["invoice.created", "invoice.created"]), false);
  assert.equal(validateWebhookEventTypes(["invoice.deleted"]), false);
  assert.equal(validateWebhookEventTypes([]), false);
  assert.equal(validateWebhookEventTypes(WORKSPACE_EVENT_TYPES), true);
});

test("webhook endpoints require HTTPS and reject local/private destinations", () => {
  assert.equal(validateWebhookEndpoint("https://hooks.example.com/plivex").ok, true);
  assert.equal(validateWebhookEndpoint("http://hooks.example.com").code, "HTTPS_REQUIRED");
  assert.equal(validateWebhookEndpoint("https://localhost/hook").code, "PRIVATE_HOST_NOT_ALLOWED");
  assert.equal(validateWebhookEndpoint("https://192.168.1.2/hook").code, "PRIVATE_HOST_NOT_ALLOWED");
  assert.equal(validateWebhookEndpoint("https://user:pass@example.com").code, "HTTPS_REQUIRED");
});

test("webhook retry backoff is bounded and dead-letters after the attempt budget", () => {
  assert.equal(getWebhookRetryDelaySeconds(0), 30);
  assert.equal(getWebhookRetryDelaySeconds(1), 60);
  assert.equal(getWebhookRetryDelaySeconds(5), 960);
  assert.equal(getWebhookRetryDelaySeconds(11), 21600);
  assert.equal(getWebhookRetryDelaySeconds(12), null);
  assert.equal(getWebhookRetryDelaySeconds(-1), null);
});
