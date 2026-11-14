import { handleCashfreeRefundEvent, isCashfreeRefundEvent } from "./refund.ts";

const order = { id: "00000000-0000-0000-0000-000000000001", currency: "INR" };
const orderId = "PLXCF-12345678123412341234123456";
const successEvent = {
  type: "REFUND_STATUS_WEBHOOK",
  data: { refund: {
    cf_refund_id: "CF-REFUND-1",
    cf_payment_id: 777123,
    order_id: orderId,
    refund_status: "SUCCESS",
    refund_amount: 49.5,
    refund_currency: "INR",
  } },
};

Deno.test("Cashfree refund handler forwards exact order and payment identifiers to the RPC", async () => {
  let calls = 0;
  const response = await handleCashfreeRefundEvent(successEvent, order, async (args) => {
    calls++;
    const raw = args.p_raw as typeof successEvent;
    if (args.p_subscription_id !== order.id || args.p_provider_refund_id !== "CF-REFUND-1" ||
        args.p_amount_minor !== 4950 || args.p_currency !== "INR" || args.p_refund_status !== "success" ||
        raw.data.refund.cf_payment_id !== 777123 || raw.data.refund.order_id !== orderId) {
      throw new Error("Refund RPC arguments did not preserve the verified payment mapping");
    }
    return { data: { ok: true, refund_status: "partially_refunded", refunded_minor_units: 4950,
      payment_refunded_minor_units: 4950, already_applied: false }, error: null };
  });
  const body = await response!.json();
  if (response?.status !== 200 || !body.received || body.alreadyApplied ||
      body.paymentRefundedMinorUnits !== 4950 || calls !== 1) {
    throw new Error("Valid refund event was not applied");
  }
});

Deno.test("Cashfree refund handler rejects missing or malformed payment mapping without calling the RPC", async () => {
  let calls = 0;
  const invalidEvents = [
    { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_status: "SUCCESS", refund_amount: 10 } } },
    { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: "R-2", cf_payment_id: 1, order_id: orderId, refund_status: "UNKNOWN", refund_amount: 10 } } },
    { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: "R-3", cf_payment_id: 1, order_id: orderId, refund_status: "SUCCESS", refund_amount: 0 } } },
    { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: "R-4", cf_payment_id: 1, order_id: orderId, refund_status: "SUCCESS", refund_amount: 1.001 } } },
    { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: "R-5", order_id: orderId, refund_status: "SUCCESS", refund_amount: 1 } } },
    { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: "R-6", cf_payment_id: 1, refund_status: "SUCCESS", refund_amount: 1 } } },
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

Deno.test("Cashfree refund handler reports duplicate replay as already applied", async () => {
  let calls = 0;
  const replayRpc = async () => {
    calls++;
    return { data: { ok: true, refund_status: "success", refunded_minor_units: 4950,
      payment_refunded_minor_units: 4950, already_applied: true }, error: null };
  };
  const first = await handleCashfreeRefundEvent(successEvent, order, replayRpc);
  const replay = await handleCashfreeRefundEvent(successEvent, order, replayRpc);
  const replayBody = await replay!.json();
  if (first?.status !== 200 || replay?.status !== 200 || !replayBody.alreadyApplied || calls !== 2) {
    throw new Error("Refund replay was not reported as idempotently applied");
  }
});

Deno.test("Cashfree refund handler maps cancellation to failed and surfaces payment mapping conflicts", async () => {
  const cancelled = await handleCashfreeRefundEvent({
    type: "REFUND_STATUS_WEBHOOK",
    data: { refund: { refund_id: "R-CANCEL", cf_payment_id: 777123, order_id: orderId,
      refund_status: "CANCELLED", refund_amount: 1 } },
  }, order, async (args) => {
    if (args.p_refund_status !== "failed") throw new Error("Cancelled refund status was not normalized");
    return { data: { ok: true, refund_status: "failed" }, error: null };
  });
  const onHold = await handleCashfreeRefundEvent({
    type: "REFUND_STATUS_WEBHOOK",
    data: { refund: { refund_id: "R-ONHOLD", cf_payment_id: 777123, order_id: orderId,
      refund_status: "ONHOLD", refund_amount: 1 } },
  }, order, async (args) => {
    if (args.p_refund_status !== "pending") throw new Error("On-hold refund was not normalized to pending");
    return { data: { ok: true, refund_status: "pending" }, error: null };
  });
  const ambiguous = await handleCashfreeRefundEvent(successEvent, order, async () => ({
    data: { ok: false, reason: "payment_mapping_ambiguous" }, error: null,
  }));
  if (cancelled?.status !== 200 || onHold?.status !== 200 || ambiguous?.status !== 409) {
    throw new Error("Refund mapping conflict/cancellation handling failed");
  }
});

Deno.test("non-refund Cashfree payment events do not enter the refund handler", async () => {
  const paymentEvent = { type: "PAYMENT_SUCCESS_WEBHOOK", data: {
    order: { order_id: orderId }, payment: { payment_status: "SUCCESS" },
  } };
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
        cf_payment_id: 777123,
        order_id: orderId,
        refund_status: "SUCCESS",
        refund_amount: testCase.amount,
      } },
    };
    const response = await handleCashfreeRefundEvent(event, order, async (args) => {
      rpcCalls++;
      if (args.p_amount_minor !== testCase.expectedMinor ||
          !Number.isSafeInteger(args.p_amount_minor) || args.p_amount_minor <= 0) {
        throw new Error(`Atomic refund RPC received incorrect minor units for ${testCase.amount}`);
      }
      return { data: { ok: true, refunded_minor_units: args.p_amount_minor }, error: null };
    });
    if (response?.status !== 200 || rpcCalls !== 1) {
      throw new Error(`Valid decimal refund ${testCase.amount} was not applied`);
    }
  }
});
