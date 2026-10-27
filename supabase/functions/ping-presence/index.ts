import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const allowed = (o: string | null) => !o || ORIGINS.has(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.workers\.dev$/.test(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.pages\.dev$/.test(o);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && allowed(o) ? o : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json" } });
const todayIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!allowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in to update presence." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return json({ error: "Presence service is not configured." }, 503, origin);
  try {
    const supabase = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);
    const { data: profile, error: pErr } = await supabase.from("profiles").select("workspace_id,role,full_name,email").eq("id", user.id).maybeSingle();
    if (pErr || !profile?.workspace_id) return json({ error: "Your Plivex workspace could not be found." }, 403, origin);
    const body = await req.json().catch(() => ({}));
    const page = typeof body?.page === "string" ? body.page.replace(/[<>]/g, "").trim().slice(0, 120) : "";
    const now = new Date().toISOString();
    const { data: existing, error: readErr } = await supabase.from("staff_activity").select("id,actions,today_date,today_invoices,today_quotations,today_revenue").eq("created_by", user.id).eq("workspace_id", profile.workspace_id).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (readErr) return json({ error: "Could not read staff presence." }, readErr.code === "42501" ? 403 : 400, origin);
    const patch = { created_by: user.id, workspace_id: profile.workspace_id, name: profile.full_name || user.user_metadata?.full_name || "", email: profile.email || user.email || "", role: profile.role || "employee", current_page: page, last_ping_at: now };
    const result = existing
      ? await supabase.from("staff_activity").update({ ...patch, updated_at: now }).eq("id", existing.id).select("id,last_ping_at,current_page").single()
      : await supabase.from("staff_activity").insert({ ...patch, today_date: todayIndia(), today_invoices: 0, today_quotations: 0, today_revenue: 0, actions: [] }).select("id,last_ping_at,current_page").single();
    if (result.error) {
      console.error("ping-presence write failed", { code: result.error.code, userId: user.id });
      return json({ error: "Could not update staff presence. Check workspace permissions." }, result.error.code === "42501" ? 403 : 400, origin);
    }
    return json({ ok: true, presence: result.data }, 200, origin);
  } catch (error) {
    console.error("ping-presence failed", error);
    return json({ error: "Something went wrong while updating presence." }, 500, origin);
  }
});