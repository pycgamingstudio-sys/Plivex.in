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
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in to track staff activity." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return json({ error: "Staff activity service is not configured." }, 503, origin);

  try {
    const supabase = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);

    const body = await req.json().catch(() => ({}));
    const label = typeof body?.label === "string" ? body.label.trim().slice(0, 200) : "";
    const type = typeof body?.type === "string" ? body.type : "";
    const revenue = body?.revenue == null ? 0 : Number(body.revenue);
    if (!label) return json({ error: "Missing label" }, 400, origin);
    if (!["invoice", "quotation", "revenue", "other"].includes(type)) return json({ error: "Invalid type" }, 400, origin);
    if (!Number.isFinite(revenue) || revenue < 0 || revenue > 1e10) return json({ error: "Invalid revenue" }, 400, origin);

    const { data: profile, error: pErr } = await supabase.from("profiles").select("workspace_id,role,full_name,email").eq("id", user.id).maybeSingle();
    if (pErr || !profile?.workspace_id) return json({ error: "Your Plivex workspace could not be found." }, 403, origin);

    const { data: rows, error: readErr } = await supabase.from("staff_activity").select("id,actions,today_date,today_invoices,today_quotations,today_revenue").eq("created_by", user.id).eq("workspace_id", profile.workspace_id).order("updated_at", { ascending: false }).limit(1);
    if (readErr) return json({ error: "Could not read staff activity." }, readErr.code === "42501" ? 403 : 400, origin);
    const existing = rows?.[0] ?? null;
    const now = new Date().toISOString(), day = todayIndia();
    const reset = existing?.today_date !== day;
    const previous = Array.isArray(existing?.actions) ? existing.actions : [];
    const actions = [...previous, { label, at: now }].slice(-20);
    const todayInvoices = (reset ? 0 : Number(existing?.today_invoices || 0)) + (type === "invoice" ? 1 : 0);
    const todayQuotations = (reset ? 0 : Number(existing?.today_quotations || 0)) + (type === "quotation" ? 1 : 0);
    const todayRevenue = (reset ? 0 : Number(existing?.today_revenue || 0)) + revenue;
    const patch = { created_by: user.id, workspace_id: profile.workspace_id, name: profile.full_name || user.user_metadata?.full_name || "", email: profile.email || user.email || "", role: profile.role || "employee", actions, today_date: day, today_invoices: todayInvoices, today_quotations: todayQuotations, today_revenue: todayRevenue, last_ping_at: now, updated_at: now };
    const result = existing
      ? await supabase.from("staff_activity").update(patch).eq("id", existing.id).eq("created_by", user.id).select("id").single()
      : await supabase.from("staff_activity").insert(patch).select("id").single();
    if (result.error) {
      console.error("track-staff-action write failed", { code: result.error.code, userId: user.id });
      return json({ error: "Could not track staff action." }, result.error.code === "42501" ? 403 : 400, origin);
    }
    return json({ ok: true, todayDate: day, todayInvoices, todayQuotations, todayRevenue }, 200, origin);
  } catch (error) {
    console.error("track-staff-action failed", error);
    return json({ error: "Something went wrong while tracking staff activity." }, 500, origin);
  }
});
