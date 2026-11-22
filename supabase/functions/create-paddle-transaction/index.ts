import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PADDLE_BILLING, PADDLE_DEFAULT_LOCALE, paddleApi, paddleConfig } from "../_shared/paddle.ts";

const PLANS = {
  basic_monthly: { name: "Basic Monthly", tier: "basic", period: "month" },
  pro_monthly: { name: "Pro Monthly", tier: "pro", period: "month" },
  basic_yearly: { name: "Basic Yearly", tier: "basic", period: "year" },
  enterprise_yearly: { name: "Pro Yearly", tier: "pro", period: "year" },
} as const;
const allowedOrigins = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app", "http://localhost:5173"]);
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://plivex.in",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const isPlanId = (value: unknown): value is keyof typeof PLANS => typeof value === "string" && Object.prototype.hasOwnProperty.call(PLANS, value);
const newOrderId = () => "PLXPAD-" + crypto.randomUUID().replaceAll("-", "").slice(0, 26).toUpperCase();
const minorUnits = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in before paying." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "Payment service is not configured." }, 503, origin);

  try {
    const authClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return json({ error: "Session expired. Sign in again." }, 401, origin);
    const body = await req.json().catch(() => ({}));
    const requestedPlanId: string = typeof body?.planId === "string" ? body.planId : "";
    if (!isPlanId(requestedPlanId)) return json({ error: "Invalid plan." }, 400, origin);
    const planId = requestedPlanId;

    const { data: profile, error: profileError } = await authClient.from("profiles")
      .select("email,full_name,workspace_id,role").eq("id", user.id).maybeSingle();
    if (profileError) return json({ error: "Could not load profile." }, 500, origin);
    if (!profile?.workspace_id) return json({ error: "Your account is not linked to a workspace yet." }, 409, origin);
    if (!["admin","owner"].includes(String(profile.role || "").toLowerCase())) return json({ error: "Only the workspace owner or admin can purchase or change a subscription." }, 403, origin);

    const [{ data: business }, { data: workspace }] = await Promise.all([
      authClient.from("business_profile").select("country_code,locale_code").eq("workspace_id", profile.workspace_id).maybeSingle(),
      authClient.from("workspace_settings").select("country_code,locale_code,currency_code").eq("workspace_id", profile.workspace_id).maybeSingle(),
    ]);
    const countryCode = String(workspace?.country_code || business?.country_code || "").trim().toUpperCase();
    if (countryCode === "IN") return json({ error: "India subscriptions use Cashfree. Paddle is reserved for international workspaces." }, 409, origin);
    if (!["US", "GB", "AE", "CA", "AU", "SG"].includes(countryCode)) {
      return json({ error: "International Paddle checkout is only available for non-India workspaces. India uses Cashfree." }, 409, origin);
    }
    const billing = PADDLE_BILLING[countryCode];
    if (!billing) return json({ error: "This workspace country has no billing configuration." }, 409, origin);
    if (!billing.paymentEnabled) return json({ error: "Subscriptions are not enabled for this workspace country yet." }, 409, origin);
    const currency = billing.currency;
    if (workspace?.currency_code && workspace.currency_code !== currency) return json({ error: "Workspace currency does not match its selected country." }, 409, origin);
    const plan = PLANS[planId];
    const amountMinor = plan.period === "year" ? undefined : billing.monthly?.[plan.tier];
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return json({ error: "This plan is not available for the selected workspace country." }, 409, origin);

    const priceSecret = `PADDLE_PRICE_ID_${countryCode}_${planId.toUpperCase()}`;
    const priceId = Deno.env.get(priceSecret);
    if (!priceId || !/^pri_[a-z0-9]{20,30}$/i.test(priceId)) {
      return json({ error: `Paddle price is not configured for ${countryCode} ${planId}. Add ${priceSecret} in Supabase Edge Function secrets.`, code: "PADDLE_PRICE_NOT_CONFIGURED" }, 503, origin);
    }
    let paddle;
    try { paddle = paddleConfig(); } catch {
      return json({ error: "Paddle is not configured yet. Add PADDLE_API_KEY and PADDLE_ENV in Supabase Edge Function secrets.", code: "PADDLE_NOT_CONFIGURED" }, 503, origin);
    }

    const orderId = newOrderId();
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = String(profile.email || user.email || "").trim().toLowerCase();
    if (!email) return json({ error: "Account email is missing." }, 400, origin);
    const localeCode = String(workspace?.locale_code || business?.locale_code || PADDLE_DEFAULT_LOCALE[countryCode] || "en");
    const { data: order, error: insertError } = await admin.from("subscriptions").insert({
      user_id: user.id, user_email: email, workspace_id: profile.workspace_id,
      plan: planId, plan_id: planId, plan_name: plan.name, tier: plan.tier,
      status: "created", payment_status: "created",
      amount: Math.round(amountMinor / 100), amount_minor_units: amountMinor, amount_major: amountMinor / 100,
      currency, country_code: countryCode, locale_code: localeCode, billing_period: plan.period,
      idempotency_key: orderId, txnid: orderId, gateway: "paddle", provider: "paddle",
    }).select("id").single();
    if (insertError || !order) {
      console.error("Paddle subscription order insert failed", { code: insertError?.code });
      return json({ error: "Could not create the subscription order." }, 500, origin);
    }

    try {
      const appBase = (Deno.env.get("APP_BASE_URL") || paddle.appBase).replace(/\/$/, "");
      const response = await paddleApi("/transactions", {
        method: "POST",
        headers: { "Idempotency-Key": orderId },
        body: JSON.stringify({
          items: [{ price_id: priceId, quantity: 1 }],
          collection_mode: "automatic",
          enable_checkout: true,
          checkout: { url: appBase + "/payment-result" },
          custom_data: {
            plivex_order_id: orderId,
            plivex_subscription_id: order.id,
            workspace_id: profile.workspace_id,
            user_id: user.id,
            plan_id: planId,
            country_code: countryCode,
            currency_code: currency,
          },
        }),
      });
      const transaction = response?.data;
      const checkoutUrl = transaction?.checkout?.url;
      const subtotalMinor = minorUnits(transaction?.details?.totals?.subtotal);
      if (typeof checkoutUrl !== "string" || !checkoutUrl.startsWith("https://")
        || transaction?.currency_code !== currency || subtotalMinor !== amountMinor) {
        throw new Error("Paddle price configuration does not match the workspace currency and saved plan price.");
      }
      const { error: updateError } = await admin.from("subscriptions").update({
        txnid: transaction.id,
        provider_order_status: String(transaction.status || "ready"),
        provider_payment_status: "pending",
      }).eq("id", order.id).eq("status", "created");
      if (updateError) throw new Error("Could not save the Paddle transaction reference.");
      return json({
        ok: true, checkoutUrl, transactionId: transaction.id, environment: paddle.environment,
        currency, amountMinor, countryCode, planId,
      }, 200, origin);
    } catch (error) {
      await admin.from("subscriptions").update({ status: "failed", payment_status: "failed", provider_payment_status: "failed", updated_at: new Date().toISOString() }).eq("id", order.id).eq("status", "created");
      console.error("Paddle transaction creation failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: error instanceof Error ? error.message : "Paddle could not start checkout." }, 502, origin);
    }
  } catch (error) {
    console.error("create-paddle-transaction failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Could not start Paddle checkout." }, 500, origin);
  }
});
