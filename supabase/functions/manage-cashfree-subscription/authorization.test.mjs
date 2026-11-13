import { isCashfreeSubscription } from "./authorization.mjs";

Deno.test("Cashfree cancellation accepts only Cashfree subscription rows", () => {
  if (!isCashfreeSubscription({ gateway: "cashfree", provider: "cashfree" })) {
    throw new Error("Cashfree subscription was rejected");
  }
  for (const row of [
    { gateway: "payu", provider: "payu" },
    { gateway: "cashfree", provider: "payu" },
    { gateway: "payu", provider: "cashfree" },
    { gateway: null, provider: null },
    null,
  ]) {
    if (isCashfreeSubscription(row)) {
      throw new Error("Non-Cashfree subscription was accepted");
    }
  }
});
