import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const allowed = (o: string | null) => !o || ORIGINS.has(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.workers\.dev$/.test(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.pages\.dev$/.test(o);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && allowed(o) ? o : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!allowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in to check plan access." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return json({ error: "Access service is not configured." }, 503, origin);
  try {
    const supabase = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);
    const nowIso = new Date().toISOString();
    const { data: subs, error } = await supabase.from("subscriptions").select("tier,expires_at")
      .eq("user_id", user.id).eq("status", "active").gt("expires_at", nowIso).order("expires_at", { ascending: false }).limit(10);
    if (error) return json({ error: "Could not check subscription access." }, error.code === "42501" ? 403 : 400, origin);
    const best = (subs || []).find((s) => s.tier === "pro") || (subs || []).find((s) => s.tier === "basic") || null;
    // The current product has a Free plan, not the archived 14-day trial.
    return json({ isPremium: !!best, tier: best?.tier || "free", trialActive: false, trialExpiresAt: null, expiresAt: best?.expires_at || null }, 200, origin);
  } catch (error) {
    console.error("get-access-status failed", error);
    return json({ error: "Something went wrong while checking access." }, 500, origin);
  }
});
