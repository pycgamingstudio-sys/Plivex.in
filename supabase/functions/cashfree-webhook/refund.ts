import { majorToMinorUnits } from "../_shared/cashfree.ts";

type RefundRpc = (args: {
  p_subscription_id: string;
  p_order_id: string;
  p_provider_payment_id: string;
  p_provider_refund_id: string;
  p_amount_minor: number;
  p_currency: string;
  p_refund_status: string;
  p_raw: unknown;
}) => Promise<{ data: any; error: unknown }>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export function isCashfreeRefundEvent(event: any): boolean {
  const refund = event?.data?.refund || {};
  const eventType = String(event?.type || event?.event_type || "").toUpperCase();
  return eventType.includes("REFUND") || Boolean(refund.refund_id || refund.cf_refund_id);
}

export async function handleCashfreeRefundEvent(
  event: any,
  order: { id: string; txnid?: string | null; currency?: string | null },
  applyRefund: RefundRpc,
): Promise<Response | null> {
  if (!isCashfreeRefundEvent(event)) return null;
  const refund = event?.data?.refund || {};
  const refundId = String(refund.cf_refund_id || refund.refund_id || "");
  const refundOrderId = String(refund.order_id || "");
  const providerPaymentId = String(refund.cf_payment_id || "");
  const refundStatus = String(refund.refund_status || "").toUpperCase();
  const refundAmount = Number(refund.refund_amount ?? refund.amount);
  // Convert the provider major-unit value using exact decimal arithmetic.
  // Do not multiply by 100: binary floating-point can turn 0.29 into a
  // non-integer minor-unit value and incorrectly reject a valid refund.
  const refundMinor = majorToMinorUnits(refundAmount);
  if (
    !refundId ||
    !refundOrderId ||
    !providerPaymentId ||
    !order.txnid ||
    refundOrderId !== order.txnid ||
    !["SUCCESS", "PENDING", "FAILED", "CANCELLED"].includes(refundStatus) ||
    refundMinor === null ||
    refundMinor <= 0
  ) return json({ error: "Invalid refund event" }, 400);

  const normalizedStatus = refundStatus === "CANCELLED" ? "failed" : refundStatus.toLowerCase();
  const { data: result, error } = await applyRefund({
    p_subscription_id: order.id,
    p_order_id: refundOrderId,
    p_provider_payment_id: providerPaymentId,
    p_provider_refund_id: refundId,
    p_amount_minor: refundMinor,
    p_currency: String(order.currency || "INR").toUpperCase(),
    p_refund_status: normalizedStatus,
    p_raw: event,
  });
  if (error) return json({ error: "Atomic refund reconciliation failed" }, 503);
  if (!result?.ok) {
    const conflict =
      result?.reason === "cumulative_refund_exceeds_payment" ||
      result?.reason === "refund_amount_conflict" ||
      result?.reason === "refund_id_already_used" ||
      result?.reason === "payment_log_not_found" ||
      result?.reason === "ambiguous_payment_log" ||
      result?.reason === "historical_unlinked_refund";
    return json(
      { error: "Refund could not be reconciled", reason: result?.reason || "refund_not_applied" },
      conflict ? 409 : 503,
    );
  }
  return json({
    received: true,
    refundStatus: result.refund_status || result.reason || normalizedStatus,
    refundedMinorUnits: result.refunded_minor_units ?? null,
    paymentRefundedMinorUnits: result.payment_refunded_minor_units ?? null,
    alreadyApplied: Boolean(result.already_applied),
  });
}
