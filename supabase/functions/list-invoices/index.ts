import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const allowed = (o: string | null) => !o || ORIGINS.has(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:pages|workers)\.dev$/.test(o);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && allowed(o) ? o : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json", "Cache-Control": "no-store" } });
async function getUserClient(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return { error: "Please sign in.", status: 401 as const };
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return { error: "Invoice service is not configured.", status: 503 as const };
  const db = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return { error: "Your session expired. Please sign in again.", status: 401 as const };
  const { data: profile, error: pErr } = await db.from("profiles").select("workspace_id").eq("id", user.id).maybeSingle();
  if (pErr) return { error: "Could not load workspace.", status: 500 as const };
  if (!profile?.workspace_id) return { error: "Workspace not found.", status: 403 as const };
  return { db, user, workspaceId: profile.workspace_id };
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!allowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  try {
    const auth = await getUserClient(req);
    if ("error" in auth) return json({ error: auth.error }, auth.status, origin);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(1000, Math.max(1, Number(body?.limit) || 1000));
    const { data, error } = await auth.db.from("invoices").select("*,invoice_items(*)")
      .eq("workspace_id", auth.workspaceId).order("created_at", { ascending: false }).limit(limit);
    if (error) return json({ error: "Could not load invoices." }, error.code === "42501" ? 403 : 400, origin);
    return json({ invoices: data || [] }, 200, origin);
  } catch (error) {
    console.error("list-invoices failed", error);
    return json({ error: "Something went wrong while loading invoices." }, 500, origin);
  }
});
