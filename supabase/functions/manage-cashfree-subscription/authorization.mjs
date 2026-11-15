export function isCashfreeSubscription(subscription) {
  return Boolean(
    subscription &&
    String(subscription.gateway || "").toLowerCase() === "cashfree" &&
    String(subscription.provider || "").toLowerCase() === "cashfree"
  );
}
