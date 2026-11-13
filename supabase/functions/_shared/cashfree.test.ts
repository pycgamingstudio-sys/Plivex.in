import { resolvePlan } from "./cashfree.ts";

Deno.test("country pricing is resolved server-side from the shared registry", () => {
  const us = resolvePlan("basic_monthly", "US");
  if (!us.available || us.currency !== "USD" || us.amountMinor !== 599) throw new Error("US Basic price mismatch");
  const gb = resolvePlan("pro_monthly", "GB");
  if (!gb.available || gb.currency !== "GBP" || gb.amountMinor !== 899) throw new Error("UK Pro price mismatch");
  const inr = resolvePlan("basic_monthly", "IN");
  if (!inr.available || inr.currency !== "INR" || inr.amountMinor !== 19900) throw new Error("India Basic compatibility mismatch");
});

Deno.test("Cashfree currency and billing-period restrictions fail closed", () => {
  const uae = resolvePlan("basic_monthly", "AE");
  if (uae.available || uae.reason !== "cashfree_currency_unavailable") throw new Error("AED must remain blocked until provider currency is confirmed");
  const globalYearly = resolvePlan("basic_yearly", "US");
  if (globalYearly.available) throw new Error("Global yearly billing must remain disabled until priced");
  const unknown = resolvePlan("basic_monthly", "ZZ");
  if (unknown.available) throw new Error("Unknown country must not fall back to India");
});

Deno.test("published plan price is consistent across accounts in the same country", () => {
  const india = resolvePlan("basic_monthly", "IN");
  const usa = resolvePlan("basic_monthly", "US");
  if (!india.available || india.amountMinor !== 19900 || !usa.available || usa.amountMinor !== 599)
    throw new Error("Published country prices must be stable and account-independent");
});


Deno.test("Cashfree webhook HMAC accepts only the exact signed timestamp and raw body", async () => {
  const { verifyWebhookSignature } = await import("./cashfree.ts");
  const secret = "ci-only-cashfree-webhook-secret";
  const timestamp = "1794580000";
  const raw = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "PLXCF-TEST" } } });
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + raw));
  const signature = btoa(String.fromCharCode(...new Uint8Array(digest)));

  if (!await verifyWebhookSignature(raw, timestamp, signature, secret)) {
    throw new Error("Valid Cashfree webhook signature was rejected");
  }
  if (await verifyWebhookSignature(raw + " ", timestamp, signature, secret)) {
    throw new Error("Modified raw webhook body was accepted");
  }
  if (await verifyWebhookSignature(raw, timestamp + "1", signature, secret)) {
    throw new Error("Modified webhook timestamp was accepted");
  }
  if (await verifyWebhookSignature(raw, timestamp, signature, "wrong-secret")) {
    throw new Error("Wrong webhook secret was accepted");
  }
  if (await verifyWebhookSignature(raw, timestamp, "", secret)) {
    throw new Error("Missing webhook signature was accepted");
  }
});
