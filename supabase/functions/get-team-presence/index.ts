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
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in to view team presence." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return json({ error: "Presence service is not configured." }, 503, origin);
  try {
    const supabase = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);
    const { data: profile, error: pErr } = await supabase.from("profiles").select("role,workspace_id").eq("id", user.id).maybeSingle();
    if (pErr || profile?.role !== "admin" || !profile.workspace_id) return json({ error: "Admin only" }, 403, origin);
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.userIds) ? [...new Set(body.userIds.filter((v: unknown) => typeof v === "string" && v.length <= 80))].slice(0, 100) : [];
    let query = supabase.from("staff_activity")
      .select("id,created_by,workspace_id,name,email,role,current_page,last_ping_at,today_date,today_invoices,today_quotations,today_revenue,actions,created_at,updated_at")
      .eq("workspace_id", profile.workspace_id).order("last_ping_at", { ascending: false }).limit(100);
    if (ids.length) query = query.in("created_by", ids);
    const { data, error } = await query;
    if (error) {
      console.error("get-team-presence query failed", { code: error.code, userId: user.id });
      return json({ error: "Could not load team presence." }, error.code === "42501" ? 403 : 400, origin);
    }
    const today = todayIndia();
    const now = Date.now();
    const members = (data || []).map((m) => {
      const age = m.last_ping_at ? now - new Date(m.last_ping_at).getTime() : Infinity;
      const status = age < 2 * 60_000 ? "ONLINE" : age < 10 * 60_000 ? "IDLE" : "OFFLINE";
      const stale = m.today_date !== today;
      return { id: m.id, created_by_id: m.created_by, workspace_id: m.workspace_id, name: m.name || "", email: m.email || "", role: m.role || "employee",
        current_page: m.current_page || "", last_ping_at: m.last_ping_at, status, today_date: m.today_date,
        today_invoices: stale ? 0 : m.today_invoices, today_quotations: stale ? 0 : m.today_quotations,
        today_revenue: stale ? 0 : Number(m.today_revenue || 0), actions: m.actions || [], created_date: m.created_at, updated_date: m.updated_at };
    });
    return json({ workspaceId: profile.workspace_id, members, requestId: crypto.randomUUID() }, 200, origin);
  } catch (error) {
    console.error("get-team-presence failed", error);
    return json({ error: "Something went wrong while loading team presence." }, 500, origin);
  }
});
