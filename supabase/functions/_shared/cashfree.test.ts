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


Deno.test("Cashfree order IDs use the PLXCF prefix and the exact provider-safe format", async () => {
  const { createCashfreeOrderId, isCashfreeOrderId } = await import("./cashfree.ts");
  const id = createCashfreeOrderId(() => "12345678-1234-1234-1234-123456789abc");
  if (id !== "PLXCF-12345678123412341234123456") throw new Error("Unexpected Cashfree order ID");
  if (!isCashfreeOrderId(id)) throw new Error("Generated order ID failed validation");
  for (const invalid of [
    "PLX-12345678123412341234123456",
    "PLXCF-short",
    "PLXCF-1234567812341234123412345678901",
    "PLXCF-1234567812341234123412345!",
    "",
    null,
  ]) {
    if (isCashfreeOrderId(invalid)) throw new Error("Invalid order ID was accepted: " + String(invalid));
  }
});

Deno.test("Cashfree India payment activation preserves INR minor units and RPC identity", async () => {
  const { activatePaidOrder } = await import("./cashfree.ts");
  const received: Record<string, unknown>[] = [];
  const admin = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      received.push(args);
      return { data: { ok: true, already_applied: false }, error: null };
    },
  };
  const order = {
    id: "00000000-0000-0000-0000-000000000001",
    txnid: "PLXCF-12345678123412341234123456",
    status: "created",
    plan_id: "basic_monthly",
    currency: "INR",
    amount_minor_units: 19900,
  };
  const result = await activatePaidOrder(
    admin,
    order,
    { order_id: order.txnid, order_status: "PAID", order_currency: "INR", order_amount: 199 },
    { payment_status: "SUCCESS", payment_currency: "INR", payment_amount: 199, cf_payment_id: "CI-PAYMENT-1" },
    "cashfree-webhook-test",
  );
  if (!result.ok || result.alreadyApplied) throw new Error("Valid India payment was not accepted");
  const rpcArgs = received[0];
  if (rpcArgs?.p_currency !== "INR" || rpcArgs?.p_amount_minor !== 19900 ||
      rpcArgs?.p_subscription_id !== order.id) {
    throw new Error("India payment RPC arguments changed");
  }
});


Deno.test("Cashfree major-to-minor conversion is exact and rejects malformed values", async () => {
  const { majorToMinorUnits } = await import("./cashfree.ts");
  const valid: Array<[number, number]> = [[199, 19900], [5.99, 599], [0.29, 29], [12.3, 1230]];
  for (const [major, minor] of valid) {
    if (majorToMinorUnits(major) !== minor) throw new Error(`Expected ${major} to convert to ${minor}`);
  }
  for (const invalid of [5.991, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e20, "5.99", null, undefined]) {
    if (majorToMinorUnits(invalid) !== null) throw new Error("Invalid provider amount was accepted: " + String(invalid));
  }
});

Deno.test("Cashfree payment activation requires exact provider order and payment amounts and currencies", async () => {
  const { activatePaidOrder } = await import("./cashfree.ts");
  const order = {
    id: "00000000-0000-0000-0000-000000000002",
    txnid: "PLXCF-12345678123412341234123456",
    status: "created",
    plan_id: "basic_monthly",
    currency: "USD",
    amount_minor_units: 599,
  };
  const providerOrder = { order_id: order.txnid, order_status: "PAID", order_currency: "USD", order_amount: 5.99 };
  const payment = { payment_status: "SUCCESS", payment_currency: "USD", payment_amount: 5.99, cf_payment_id: "CI-PAYMENT-USD" };
  let rpcCalls: number = 0;
  const admin = { rpc: async () => { rpcCalls++; return { data: { ok: true, already_applied: false }, error: null }; } };
  const run = async (po: Record<string, unknown>, pay: Record<string, unknown>) =>
    activatePaidOrder(admin, order, po, pay, "cashfree-amount-validation-test");

  const valid = await run(providerOrder, payment);
  if (!valid.ok || rpcCalls !== 1) throw new Error("Valid two-decimal USD payment was rejected");

  const invalidCases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["fractional minor-unit payment", providerOrder, { ...payment, payment_amount: 5.991 }],
    ["missing payment amount", providerOrder, { payment_status: "SUCCESS", payment_currency: "USD", cf_payment_id: "MISSING-AMOUNT" }],
    ["missing payment currency", providerOrder, { ...payment, payment_currency: undefined }],
    ["wrong payment currency", providerOrder, { ...payment, payment_currency: "EUR" }],
    ["wrong order currency", { ...providerOrder, order_currency: "EUR" }, payment],
    ["missing order amount", { ...providerOrder, order_amount: undefined }, payment],
    ["fractional order amount", { ...providerOrder, order_amount: 5.991 }, payment],
    ["amount mismatch", providerOrder, { ...payment, payment_amount: 6.00 }],
    ["invalid numeric amount", providerOrder, { ...payment, payment_amount: Number.NaN }],
    ["negative payment amount", providerOrder, { ...payment, payment_amount: -5.99 }],
  ];
  for (const [label, po, pay] of invalidCases) {
    const result = await run(po, pay);
    if (result.ok) throw new Error(label + " was not rejected before the payment RPC");
  }
});
