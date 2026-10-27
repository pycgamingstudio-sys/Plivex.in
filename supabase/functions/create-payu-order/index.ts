import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { allowedOrigin, config, isPlanId, PLANS, randomTxn, requestHash, safePath } from "../_shared/payu.ts";

const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const cors = (origin: string | null) => ({ "Access-Control-Allow-Origin": origin && (ORIGINS.has(origin) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.pages\.dev$/.test(origin)) ? origin : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req: Request) => {
  const originHeader = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(originHeader) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, originHeader);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in before starting a payment." }, 401, originHeader);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "Payment service is not configured." }, 503, originHeader);
  let cfg;
  try { cfg = config(); } catch { return json({ error: "PayU merchant secrets are not configured." }, 503, originHeader); }
  try {
    const authClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, originHeader);
    const body = await req.json().catch(() => ({}));
    if (!isPlanId(body?.planId)) return json({ error: "Invalid planId" }, 400, originHeader);
    const phone = body.phone == null || body.phone === "" ? "" : String(body.phone).replace(/\s/g, "");
    if (phone && !/^\+?\d{10,13}$/.test(phone)) return json({ error: "Invalid phone" }, 400, originHeader);
    const { data: profile, error: profileError } = await authClient.from("profiles").select("email,full_name,workspace_id").eq("id", user.id).maybeSingle();
    if (profileError) return json({ error: "Could not load account profile." }, 500, originHeader);
    const email = String(profile?.email || user.email || "").trim();
    if (!email) return json({ error: "Account has no email" }, 400, originHeader);
    const plan = PLANS[body.planId];
    const amount = (plan.amountPaise / 100).toFixed(2);
    const txnid = randomTxn();
    const firstname = String(profile?.full_name || user.user_metadata?.full_name || email.split("@")[0] || "Customer").replace(/[^A-Za-z0-9 ]/g, "").slice(0, 60) || "Customer";
    const fallback = cfg.appBase;
    const returnOrigin = allowedOrigin(body.origin, fallback);
    const returnPath = safePath(body.path);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: insertError } = await admin.from("subscriptions").insert({
      user_id: user.id, user_email: email, workspace_id: profile?.workspace_id || null,
      plan: plan.id, plan_id: plan.id, plan_name: plan.name, tier: plan.tier,
      status: "created", amount: Math.round(plan.amountPaise / 100), amount_paise: plan.amountPaise,
      currency: "INR", gateway: "payu", provider: "payu", txnid, payu_txnid: txnid,
      phone: phone || null, return_origin: returnOrigin, return_path: returnPath,
    });
    if (insertError) {
      console.error("create-payu-order insert failed", { code: insertError.code, userId: user.id });
      return json({ error: "Could not create payment order." }, 500, originHeader);
    }
    const callback = `${url.replace(/\/$/, "")}/functions/v1/verify-payu-payment`;
    const fields = { key: cfg.key, txnid, amount, productinfo: plan.id, firstname, email, phone,
      surl: callback, furl: callback,
      hash: await requestHash({ key: cfg.key, txnid, amount, productinfo: plan.id, firstname, email }, cfg.salt),
      service_provider: "payu_paisa" };
    return json({ environment: cfg.environment, action: cfg.action, txnid, fields }, 200, originHeader);
  } catch (error) {
    console.error("create-payu-order failed", error);
    return json({ error: "Could not start payment. Please try again." }, 500, originHeader);
  }
});
