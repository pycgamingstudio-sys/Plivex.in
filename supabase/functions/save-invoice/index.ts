import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const allowed = (o: string | null) => !o || ORIGINS.has(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:pages|workers)\.dev$/.test(o);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && allowed(o) ? o : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!allowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ error: "Invoice service is not configured." }, 503, origin);
  try {
    const db = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body?.items) || body.items.length > 500) return json({ error: "Invalid invoice items." }, 400, origin);
    const invoiceId = body.invoiceId ?? body.id ?? null;
    if (invoiceId !== null && (typeof invoiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(invoiceId))) return json({ error: "Invalid invoice id." }, 400, origin);
    const { items, id, invoiceId: _ignored, ...data } = body;
    const safeItems = items.map((it: Record<string, unknown>) => ({
      description: typeof it?.description === "string" ? it.description.slice(0, 500) : "",
      quantity: Number.isFinite(Number(it?.quantity)) ? Math.max(0, Number(it.quantity)) : 0,
      rate: Number.isFinite(Number(it?.rate)) ? Math.max(0, Number(it.rate)) : 0,
      ...(it?.gst_rate === undefined || it?.gst_rate === null || it?.gst_rate === "" ? {} : { gst_rate: Number.isFinite(Number(it.gst_rate)) ? Math.max(0, Number(it.gst_rate)) : 0 }),
    }));
    const { data: saved, error } = await db.rpc("save_invoice", { _data: data, _items: safeItems, _invoice_id: invoiceId });
    if (error || !saved?.id) {
      const status = error?.code === "42501" ? 403 : error?.code === "P0002" ? 404 : 400;
      return json({ error: error?.message || "Could not save invoice." }, status, origin);
    }
    const { data: invoice, error: readError } = await db.from("invoices").select("*,invoice_items(*)")
      .eq("id", saved.id).maybeSingle();
    if (readError || !invoice) return json({ error: "Invoice saved but could not be reloaded." }, 500, origin);
    return json({ invoice }, 200, origin);
  } catch (error) {
    console.error("save-invoice failed", error);
    return json({ error: "Something went wrong while saving the invoice." }, 500, origin);
  }
});
