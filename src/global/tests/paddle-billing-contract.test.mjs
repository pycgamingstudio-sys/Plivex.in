import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Paddle international checkout is isolated from India Cashfree and uses per-country price IDs", async () => {
  const create = await read("../../../supabase/functions/create-paddle-transaction/index.ts");
  assert.match(create, /PADDLE_PRICE_ID_/);
  assert.match(create, /PADDLE_API_KEY/);
  assert.match(create, /PADDLE_ENV/);
  assert.match(create, /countryCode === "IN"/);
  assert.match(create, /transaction\?\.currency_code !== currency/);
  assert.match(create, /subtotalMinor !== amountMinor/);
});

test("Paddle webhook verifies raw-body signatures and activates only completed transactions", async () => {
  const helper = await read("../../../supabase/functions/_shared/paddle.ts");
  const webhook = await read("../../../supabase/functions/paddle-webhook/index.ts");
  const migration = await read("../../../supabase/migrations/20261122190000_paddle_billing.sql");
  assert.match(helper, /HMAC/);
  assert.match(helper, /Paddle-Signature|h1/);
  assert.match(webhook, /verifyPaddleWebhookSignature/);
  assert.match(webhook, /transaction.completed/);
  assert.match(webhook, /apply_paddle_subscription_payment/);
  assert.match(migration, /provider_subscription_id/);
  assert.match(migration, /GRANT EXECUTE.*service_role/s);
});

test("Paddle frontend opens only a server-created HTTPS checkout URL", async () => {
  const client = await read("../../../src/lib/paddle.js");
  const resultPage = await read("../../../src/pages/PaymentResult.jsx");
  assert.match(client, /create-paddle-transaction/);
  assert.match(client, /checkoutUrl\.startsWith\("https:\/\/"\)/);
  assert.match(client, /window\.location\.assign/);
  assert.match(resultPage, /VITE_PADDLE_CLIENT_TOKEN/);
  assert.match(resultPage, /Paddle\.Initialize/);
  assert.match(resultPage, /checkout:\{ settings:\{ successUrl/);
  assert.match(resultPage, /subscriptions.*status/);
});

test("Australian Basic monthly display price is exactly AUD 799.00 in minor units", async () => {
  const pricing = await read("../billing/pricing.js");
  assert.match(pricing, /AU: Object\.freeze\(\{ currency: "AUD".*monthly: Object\.freeze\(\{ basic: 79900/);
});
