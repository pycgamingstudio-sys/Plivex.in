import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { addPeriod, allowedOrigin, config, isPlanId, PLANS, reverseHash, safeEqualHex, safePath } from "../_shared/payu.ts";

async function readParams(req: Request) {
  const out: Record<string, string> = {};
  new URL(req.url).searchParams.forEach((v, k) => { out[k] = v; });
  if (req.method === "POST") {
    const text = await req.text();
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try { for (const [k, v] of Object.entries(JSON.parse(text) || {})) out[k] = String(v ?? ""); } catch { /* invalid callback body */ }
    } else new URLSearchParams(text).forEach((v, k) => { out[k] = v; });
  }
  return out;
}
const redirect = (origin: string, path: string, query: Record<string, string>) =>
  new Response(null, { status: 302, headers: { Location: `${origin}${path}?${new URLSearchParams(query)}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
const failPage = (origin: string) => redirect(origin, "/", { payment: "failed" });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return new Response("Payment verification unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  let cfg;
  try { cfg = config(); } catch { return new Response("Payment verification unavailable", { status: 503, headers: { "Cache-Control": "no-store" } }); }
  const fallback = cfg.appBase;
  try {
    const p = await readParams(req);
    const txnid = String(p.txnid || "").trim();
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!/^PLX[A-Z0-9]{8,40}$/.test(txnid)) return failPage(fallback);

    const { data: order, error: orderError } = await admin.from("subscriptions").select("*").eq("txnid", txnid).maybeSingle();
    if (orderError || !order) return redirect(fallback, "/", { payment: "failed", txnid });
    const origin = allowedOrigin(order.return_origin, fallback);
    const path = safePath(order.return_path);
    if (order.status === "active") return redirect(origin, path, { payment: "success", txnid });
    if (order.status !== "created") return redirect(origin, path, { payment: "failed", txnid });

    const expected = await reverseHash({
      key: p.key || "", txnid, amount: p.amount || "", productinfo: p.productinfo || "",
      firstname: p.firstname || "", email: p.email || "", status: p.status || "",
      additionalCharges: p.additionalCharges || undefined,
      udf: [p.udf1 || "", p.udf2 || "", p.udf3 || "", p.udf4 || "", p.udf5 || ""],
    }, cfg.salt);
    const hashOk = !!p.hash && safeEqualHex(expected, p.hash) && p.key === cfg.key;
    const paid = Number(p.amount);
    const amountOk = Number.isFinite(paid) && order.amount_paise != null && Math.abs(paid - Number(order.amount_paise) / 100) < 0.01;
    const success = p.status === "success";
    const raw = { ...p, hash: undefined };
    const baseLog = {
      user_id: order.user_id, user_email: order.user_email, workspace_id: order.workspace_id,
      txnid, subscription_id: order.id, provider: "payu", gateway: "payu", currency: "INR",
      plan_id: order.plan_id, plan_name: order.plan_name, tier: order.tier,
      provider_status: p.status || null, gateway_status: p.status || null,
      provider_payment_id: p.mihpayid || null, payu_payment_id: p.mihpayid || null,
      raw, verified_at: new Date().toISOString(),
    };

    if (!hashOk || !amountOk || !success) {
      const tampered = !hashOk || !amountOk;
      const reason = !hashOk ? "hash_mismatch" : !amountOk ? "amount_mismatch" : `status_${p.status || "unknown"}`;
      await admin.from("payment_logs").insert({ ...baseLog, amount: Number.isFinite(paid) ? Math.round(paid * 100) : null,
        status: tampered ? "tampered" : "failed", outcome: tampered ? "tampered" : "failed",
        hash_verified: hashOk, reason, message: reason, source: "verify-payu-payment" });
      await admin.from("subscriptions").update({ status: tampered ? "tampered" : "failed", payu_payment_id: p.mihpayid || null, updated_at: new Date().toISOString() })
        .eq("id", order.id).eq("status", "created");
      return redirect(origin, path, { payment: "failed", txnid });
    }

    if (!isPlanId(order.plan_id)) {
      await admin.from("payment_logs").insert({ ...baseLog, amount: Math.round(paid * 100), status: "failed", outcome: "failed",
        hash_verified: true, reason: "unknown_plan", message: "Unknown plan", source: "verify-payu-payment" });
      return redirect(origin, path, { payment: "failed", txnid });
    }
    const now = new Date();
    const { data: updated, error: updateError } = await admin.from("subscriptions").update({
      status: "active", started_at: now.toISOString(), expires_at: addPeriod(now, PLANS[order.plan_id].period).toISOString(),
      payu_payment_id: p.mihpayid || null, updated_at: now.toISOString(),
    }).eq("id", order.id).eq("status", "created").select("id");
    if (updateError) {
      console.error("verify-payu-payment subscription update failed", { code: updateError.code, txnid });
      return new Response("Payment verification unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (updated?.length) {
      const { error: logError } = await admin.from("payment_logs").insert({ ...baseLog, amount: Math.round(paid * 100),
        status: "success", outcome: "applied", hash_verified: true, reason: null, message: "Payment verified", source: "verify-payu-payment" });
      if (logError) console.error("verify-payu-payment log failed", { code: logError.code, txnid });
      return redirect(origin, path, { payment: "success", txnid });
    }
    // A concurrent callback may have won the conditional update. Only report
    // success if the persisted order is actually active.
    const { data: latest } = await admin.from("subscriptions").select("status").eq("id", order.id).maybeSingle();
    return redirect(origin, path, { payment: latest?.status === "active" ? "success" : "failed", txnid });
  } catch (error) {
    console.error("verify-payu-payment failed", error);
    return new Response("Payment verification unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
