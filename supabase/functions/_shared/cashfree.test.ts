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
  const standard = resolvePlan("basic_monthly", "IN");
  const account = resolvePlan("basic_monthly", "IN", "customer@example.test");
  if (!standard.available || !account.available || standard.amountMinor !== 19900 || account.amountMinor !== standard.amountMinor)
    throw new Error("India published price must not vary by account email");
});
