import { majorToMinorUnits } from "../_shared/cashfree.ts";

type RefundRpc = (args: {
  p_subscription_id: string;
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
  order: { id: string; currency?: string | null },
  applyRefund: RefundRpc,
): Promise<Response | null> {
  if (!isCashfreeRefundEvent(event)) return null;
  const refund = event?.data?.refund || {};
  const refundId = String(refund.cf_refund_id || refund.refund_id || "").trim();
  const cfPaymentId = String(refund.cf_payment_id ?? "").trim();
  const refundOrderId = String(refund.order_id || event?.data?.order?.order_id || "").trim();
  const refundStatus = String(refund.refund_status || "").toUpperCase();
  const refundAmount = Number(refund.refund_amount ?? refund.amount);
  const refundMinor = majorToMinorUnits(refundAmount);

  // Both identifiers are required: order_id locates the subscription, while
  // cf_payment_id identifies the exact successful payment attempt.
  if (
    !refundId ||
    !cfPaymentId ||
    !refundOrderId ||
    !["SUCCESS", "PENDING", "FAILED", "CANCELLED", "ONHOLD"].includes(refundStatus) ||
    refundMinor === null ||
    refundMinor <= 0
  ) return json({ error: "Invalid or incomplete refund mapping" }, 400);

  const normalizedStatus = refundStatus === "CANCELLED"
    ? "failed"
    : refundStatus === "ONHOLD" ? "pending" : refundStatus.toLowerCase();
  const { data: result, error } = await applyRefund({
    p_subscription_id: order.id,
    p_provider_refund_id: refundId,
    p_amount_minor: refundMinor,
    p_currency: String(refund.refund_currency || order.currency || "INR").toUpperCase(),
    p_refund_status: normalizedStatus,
    p_raw: event,
  });
  if (error) return json({ error: "Atomic refund reconciliation failed" }, 503);
  if (!result?.ok) {
    const conflictReasons = [
      "cumulative_refund_exceeds_payment",
      "cumulative_refund_exceeds_payment_log",
      "refund_amount_conflict",
      "refund_id_already_used",
      "refund_payment_mapping_conflict",
      "payment_mapping_missing",
      "payment_mapping_not_found",
      "payment_mapping_ambiguous",
      "refund_amount_invalid",
      "historical_refund_reconciliation_required",
    ];
    return json(
      { error: "Refund could not be reconciled", reason: result?.reason || "refund_not_applied" },
      conflictReasons.includes(result?.reason) ? 409 : 503,
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
