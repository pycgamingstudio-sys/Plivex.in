import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { verifyPaddleWebhookSignature } from "../_shared/paddle.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const minorUnits = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, paddle-signature", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("PADDLE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "Paddle webhook is not configured." }, 503);
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > 1024 * 1024) return json({ error: "Request is too large." }, 413);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > 1024 * 1024) return json({ error: "Request is too large." }, 413);
  const valid = await verifyPaddleWebhookSignature(raw, req.headers.get("Paddle-Signature") || "", secret);
  if (!valid) return json({ error: "Invalid or expired Paddle signature." }, 401);

  let event: any;
  try { event = JSON.parse(raw); } catch { return json({ error: "Invalid webhook JSON." }, 400); }
  const eventType = String(event?.event_type || "");
  const data = event?.data || {};
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ error: "Payment service is not configured." }, 503);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  if (eventType === "subscription.canceled") {
    const subscriptionId = String(data?.id || "");
    if (subscriptionId) {
      const { error } = await admin.from("subscriptions").update({
        cancel_at_period_end: true,
        cancellation_requested_at: new Date().toISOString(),
        provider_order_status: "canceled",
        updated_at: new Date().toISOString(),
      }).eq("provider", "paddle").eq("gateway", "paddle").eq("provider_subscription_id", subscriptionId).eq("status", "active");
      if (error) return json({ error: "Could not sync Paddle cancellation." }, 503);
    }
    return json({ received: true, processed: true });
  }

  if (eventType !== "transaction.completed") return json({ received: true, ignored: true, eventType });
  const localOrderId = String(data?.custom_data?.plivex_order_id || "");
  const providerSubscriptionId = String(data?.subscription_id || "");
  let query = admin.from("subscriptions").select("id,plan_id,billing_period,amount_minor_units,currency,provider_subscription_id")
    .eq("provider", "paddle").eq("gateway", "paddle");
  if (localOrderId) query = query.eq("idempotency_key", localOrderId);
  else if (providerSubscriptionId) query = query.eq("provider_subscription_id", providerSubscriptionId);
  else return json({ received: true, ignored: true, reason: "No Plivex order reference." });
  const { data: order, error: orderError } = await query.maybeSingle();
  if (orderError) return json({ error: "Could not locate Paddle subscription order." }, 503);
  if (!order) return json({ received: true, ignored: true, reason: "Subscription order not found." });

  const currency = String(data?.currency_code || "").toUpperCase();
  const subtotalMinor = minorUnits(data?.details?.totals?.subtotal);
  const totalMinor = minorUnits(data?.details?.totals?.total);
  if (!/^[A-Z]{3}$/.test(currency) || subtotalMinor === null || totalMinor === null || !providerSubscriptionId) {
    return json({ error: "Paddle transaction details are incomplete." }, 422);
  }
  const { data: applied, error: applyError } = await admin.rpc("apply_paddle_subscription_payment", {
    p_subscription_id: order.id,
    p_provider_payment_id: String(data.id || ""),
    p_provider_subscription_id: providerSubscriptionId,
    p_currency: currency,
    p_subtotal_minor: subtotalMinor,
    p_total_minor: totalMinor,
    p_provider_order_status: String(data.status || ""),
    p_provider_payment_status: String(data.status || ""),
    p_raw: event,
  });
  if (applyError) {
    console.error("Paddle payment application failed", { code: applyError.code });
    return json({ error: "Payment activation is temporarily unavailable." }, 503);
  }
  if (!applied?.ok) return json({ error: "Paddle payment did not pass Plivex order validation.", reason: applied?.reason || "payment_not_applied" }, 409);
  return json({ received: true, processed: true, alreadyApplied: Boolean(applied.already_applied) });
});
