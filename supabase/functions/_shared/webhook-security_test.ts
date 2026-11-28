import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hmacSha256Base64,
  hmacSha256Hex,
  isAllowedWebhookEvent,
  isFreshWebhookTimestamp,
  verifyCustomWebhookSignature,
  verifyShopifyWebhookSignature,
} from "./webhook-security.ts";

Deno.test("custom webhook HMAC validates timestamp, event ID and exact raw body", async () => {
  const secret = "unit-test-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const eventId = "evt_stage3_0001";
  const body = '{"type":"invoice.created","id":"inv_001"}';
  const digest = await hmacSha256Hex(secret, timestamp + "." + eventId + "." + body);
  assertEquals(await verifyCustomWebhookSignature(secret, timestamp, eventId, "sha256=" + digest, body), { ok: true });
  assertEquals((await verifyCustomWebhookSignature(secret, timestamp, eventId, "sha256=" + "0".repeat(64), body)).code, "WEBHOOK_SIGNATURE_INVALID");
});

Deno.test("custom webhook rejects stale timestamps and malformed event identifiers", async () => {
  const now = Date.now();
  assertEquals(isFreshWebhookTimestamp(String(Math.floor(now / 1000) - 301), now), false);
  assertEquals(isFreshWebhookTimestamp("not-a-time", now), false);
  assertEquals((await verifyCustomWebhookSignature("secret", String(Math.floor(now / 1000)), "bad event id", "sha256=" + "0".repeat(64), "{}")).code, "WEBHOOK_EVENT_ID_INVALID");
});

Deno.test("Shopify webhook verification uses base64 HMAC over the exact raw request body", async () => {
  const secret = "shopify-app-secret";
  const body = '{"id":123,"name":"#1001"}';
  const signature = await hmacSha256Base64(secret, body);
  assertEquals(await verifyShopifyWebhookSignature(secret, signature, body), true);
  assertEquals(await verifyShopifyWebhookSignature(secret, signature, body + " "), false);
  assertEquals(await verifyShopifyWebhookSignature(secret, "bad", body), false);
});

Deno.test("webhook provider event allowlists cannot be bypassed by client input", () => {
  assertEquals(isAllowedWebhookEvent("shopify", "orders/create", ["orders/create"]), true);
  assertEquals(isAllowedWebhookEvent("shopify", "invoice.created", ["invoice.created"]), false);
  assertEquals(isAllowedWebhookEvent("custom", "invoice.created", ["invoice.created"]), true);
  assertEquals(isAllowedWebhookEvent("custom", "orders/create", ["orders/create"]), false);
  assertEquals(isAllowedWebhookEvent("custom", "stock.low_stock", []), false);
});
