import { handleCashfreeRefundEvent, isCashfreeRefundEvent } from "./refund.ts";

const order = { id: "00000000-0000-0000-0000-000000000001", currency: "INR" };
const successEvent = {
  type: "REFUND_STATUS_WEBHOOK",
  data: { refund: { cf_refund_id: "CF-REFUND-1", order_id: "PLXCF-12345678123412341234123456", refund_status: "SUCCESS", refund_amount: 49.5 } },
};

Deno.test("Cashfree refund handler applies valid INR refund events with normalized RPC arguments", async () => {
  let calls = 0;
  const response = await handleCashfreeRefundEvent(successEvent, order, async (args) => {
    calls++;
    if (args.p_subscription_id !== order.id || args.p_provider_refund_id !== "CF-REFUND-1" ||
        args.p_amount_minor !== 4950 || args.p_currency !== "INR" || args.p_refund_status !== "success" ||
        args.p_raw !== successEvent) throw new Error("Refund RPC arguments were not normalized correctly");
    return { data: { ok: true, refund_status: "partially_refunded", refunded_minor_units: 4950, already_applied: false }, error: null };
  });
  const body = await response!.json();
  if (response?.status !== 200 || !body.received || body.alreadyApplied || calls !== 1)
    throw new Error("Valid refund event was not applied");
});

Deno.test("Cashfree refund handler rejects malformed events without calling the RPC", async () => {
  let calls = 0;
  const invalidEvents = [
    { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_status: "SUCCESS", refund_amount: 10 } } },
    { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: "R-2", refund_status: "UNKNOWN", refund_amount: 10 } } },
    { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: "R-3", refund_status: "SUCCESS", refund_amount: 0 } } },
    { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: "R-4", refund_status: "SUCCESS", refund_amount: 1.001 } } },
  ];
  for (const event of invalidEvents) {
    const response = await handleCashfreeRefundEvent(event, order, async () => {
      calls++;
      return { data: { ok: true }, error: null };
    });
    if (response?.status !== 400) throw new Error("Malformed refund event was not rejected");
  }
  if (calls !== 0) throw new Error("Invalid refund event reached the RPC");
});

Deno.test("Cashfree refund handler reports replay as already applied without duplicate application", async () => {
  let calls = 0;
  const replayRpc = async () => {
    calls++;
    return { data: { ok: true, refund_status: "success", refunded_minor_units: 4950, already_applied: true }, error: null };
  };
  const first = await handleCashfreeRefundEvent(successEvent, order, replayRpc);
  const replay = await handleCashfreeRefundEvent(successEvent, order, replayRpc);
  const replayBody = await replay!.json();
  if (first?.status !== 200 || replay?.status !== 200 || !replayBody.alreadyApplied || calls !== 2)
    throw new Error("Refund replay was not reported as idempotently applied");
});

Deno.test("Cashfree refund handler maps provider cancellation to failed and surfaces over-refund conflicts", async () => {
  const cancelled = await handleCashfreeRefundEvent({
    type: "REFUND_STATUS_WEBHOOK",
    data: { refund: { refund_id: "R-CANCEL", refund_status: "CANCELLED", refund_amount: 1 } },
  }, order, async (args) => {
    if (args.p_refund_status !== "failed") throw new Error("Cancelled refund status was not normalized");
    return { data: { ok: true, refund_status: "failed" }, error: null };
  });
  const over = await handleCashfreeRefundEvent(successEvent, order, async () => ({
    data: { ok: false, reason: "cumulative_refund_exceeds_payment" }, error: null,
  }));
  if (cancelled?.status !== 200 || over?.status !== 409) throw new Error("Refund conflict/cancellation mapping failed");
});

Deno.test("non-refund Cashfree payment events do not enter the refund handler", async () => {
  const paymentEvent = { type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "PLXCF-12345678123412341234123456" }, payment: { payment_status: "SUCCESS" } } };
  if (isCashfreeRefundEvent(paymentEvent)) throw new Error("Payment event was classified as a refund");
  const response = await handleCashfreeRefundEvent(paymentEvent, order, async () => {
    throw new Error("Payment event unexpectedly called refund RPC");
  });
  if (response !== null) throw new Error("Payment event was consumed by refund handler");
});


Deno.test("Cashfree refund amounts convert exact decimal major units to integer minor units", async () => {
  const validCases = [
    { amount: 0.29, expectedMinor: 29 },
    { amount: 0.01, expectedMinor: 1 },
    { amount: 49.5, expectedMinor: 4950 },
  ];
  for (const [index, testCase] of validCases.entries()) {
    let rpcCalls = 0;
    const event = {
      type: "REFUND_STATUS_WEBHOOK",
      data: { refund: {
        refund_id: `R-DECIMAL-${index}`,
        refund_status: "SUCCESS",
        refund_amount: testCase.amount,
      } },
    };
    const response = await handleCashfreeRefundEvent(event, order, async (args) => {
      rpcCalls++;
      if (args.p_amount_minor !== testCase.expectedMinor ||
          !Number.isSafeInteger(args.p_amount_minor) ||
          args.p_amount_minor <= 0) {
        throw new Error(`Atomic refund RPC received incorrect minor units for ${testCase.amount}`);
      }
      return { data: { ok: true, refunded_minor_units: args.p_amount_minor }, error: null };
    });
    if (response?.status !== 200 || rpcCalls !== 1)
      throw new Error(`Valid decimal refund ${testCase.amount} was not applied`);
  }

  let invalidRpcCalls = 0;
  const invalid = await handleCashfreeRefundEvent({
    type: "REFUND_STATUS_WEBHOOK",
    data: { refund: {
      refund_id: "R-DECIMAL-INVALID",
      refund_status: "SUCCESS",
      refund_amount: 1.001,
    } },
  }, order, async () => {
    invalidRpcCalls++;
    return { data: { ok: true }, error: null };
  });
  if (invalid?.status !== 400 || invalidRpcCalls !== 0)
    throw new Error("Refund with more than two decimal places was not rejected before RPC");
});
