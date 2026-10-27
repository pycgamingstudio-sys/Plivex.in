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
    const id = body?.id;
    const status = body?.status;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid invoice id." }, 400, origin);
    if (!["Pending", "Paid", "Cancelled"].includes(status)) return json({ error: "Invalid invoice status." }, 400, origin);

    if (status === "Cancelled") {
      const { data, error } = await db.rpc("cancel_invoice", { _invoice_id: id });
      if (error || !data?.id) return json({ error: error?.message || "Could not cancel invoice." }, error?.code === "42501" ? 403 : 400, origin);
    } else {
      const { data: current, error: readError } = await db.from("invoices").select("*,invoice_items(*)").eq("id", id).maybeSingle();
      if (readError || !current) return json({ error: "Invoice not found or access denied." }, readError?.code === "42501" ? 403 : 404, origin);
      const data = {
        client_name: current.client_name, client_email: current.client_email, business_name: current.business_name,
        issue_date: current.issue_date, due_date: current.due_date, currency: current.currency,
        tax_mode: current.tax_mode, tax_rate: current.tax_rate, discount_type: current.discount_type,
        discount: current.discount, notes: current.notes, terms: current.terms, is_draft: current.is_draft, status,
      };
      const items = (current.invoice_items || []).map((it: Record<string, unknown>) => ({
        description: it.description, quantity: it.quantity, rate: it.rate, gst_rate: it.gst_rate,
      }));
      const { data: saved, error } = await db.rpc("save_invoice", { _data: data, _items: items, _invoice_id: id });
      if (error || !saved?.id) return json({ error: error?.message || "Could not update invoice status." }, error?.code === "42501" ? 403 : 400, origin);
    }
    const { data: invoice, error: reloadError } = await db.from("invoices").select("*,invoice_items(*)").eq("id", id).maybeSingle();
    if (reloadError || !invoice) return json({ error: "Status updated but invoice could not be reloaded." }, 500, origin);
    return json({ invoice }, 200, origin);
  } catch (error) {
    console.error("set-invoice-status failed", error);
    return json({ error: "Something went wrong while updating invoice status." }, 500, origin);
  }
});
