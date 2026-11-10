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
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "Invoice service is not configured." }, 503, origin);
  try {
    const userDb = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await userDb.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);
    const body = await req.json().catch(() => ({}));
    const id = body?.id;
    const email = String(body?.email || "").trim().toLowerCase();
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Enter a valid customer email." }, 400, origin);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin.from("profiles").select("role,workspace_id").eq("id", user.id).maybeSingle();
    if (profileError || !profile?.workspace_id || !["admin", "manager", "accountant"].includes(profile.role)) return json({ error: "You do not have permission to update this invoice." }, 403, origin);
    const { data: invoice, error: invoiceError } = await admin.from("invoices").select("id,client_id").eq("id", id).eq("workspace_id", profile.workspace_id).maybeSingle();
    if (invoiceError || !invoice) return json({ error: "Invoice not found or access denied." }, 404, origin);
    const { error: updateError } = await admin.from("invoices").update({ client_email: email, updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", profile.workspace_id);
    if (updateError) return json({ error: "Could not save customer email." }, 500, origin);
    if (invoice.client_id) await admin.from("clients").update({ email, updated_at: new Date().toISOString() }).eq("id", invoice.client_id).eq("workspace_id", profile.workspace_id);
    return json({ ok: true, email }, 200, origin);
  } catch (error) {
    console.error("update-invoice-client-email failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Could not update customer email." }, 500, origin);
  }
});