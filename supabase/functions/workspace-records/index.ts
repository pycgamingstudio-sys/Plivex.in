import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const allowed = (o: string | null) => !o || ORIGINS.has(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:pages|workers)\.dev$/.test(o);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && allowed(o) ? o : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const FIELDS: Record<string, string[]> = {
  clients: ["name","company","email","phone","gstin","address"],
  expenses: ["vendor","category","amount","date","status","method","notes"],
  stock: ["name","sku","quantity","unit","price","low_stock"],
  services: ["name","rate","gst_rate","description"],
  leads: ["name","phone","requirement","value","stage"],
  quotations: ["number","client_name","date","total","status","tax_rate","items"],
  business_profile: ["name","email","phone","gstin","address","logo_url","upi_id"],
};
const isId = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const pick = (value: unknown, fields: string[]) => {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(fields.filter((f) => Object.prototype.hasOwnProperty.call(input, f)).map((f) => [f, input[f]]));
};
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!allowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ error: "Workspace records service is not configured." }, 503, origin);
  try {
    const db = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);
    const { data: profile, error: pErr } = await db.from("profiles").select("workspace_id").eq("id", user.id).maybeSingle();
    if (pErr) return json({ error: "Could not load workspace." }, 500, origin);
    if (!profile?.workspace_id) return json({ error: "Workspace not found." }, 403, origin);
    const body = await req.json().catch(() => ({}));
    const table = typeof body?.table === "string" ? body.table : "";
    const action = typeof body?.action === "string" ? body.action : "";
    if (!Object.hasOwn(FIELDS, table)) return json({ error: "Unsupported table." }, 400, origin);
    const fields = FIELDS[table];
    if (table === "business_profile") {
      if (action === "get") {
        const { data, error } = await db.from(table).select("*").eq("workspace_id", profile.workspace_id).maybeSingle();
        if (error) return json({ error: "Could not load business profile." }, error.code === "42501" ? 403 : 400, origin);
        return json({ record: data || null }, 200, origin);
      }
      if (action === "upsert") {
        const values = { ...pick(body.values, fields), workspace_id: profile.workspace_id };
        const { data: existing, error: readError } = await db.from(table).select("id").eq("workspace_id", profile.workspace_id).maybeSingle();
        if (readError) return json({ error: "Could not load business profile." }, readError.code === "42501" ? 403 : 400, origin);
        const result = existing
          ? await db.from(table).update(values).eq("workspace_id", profile.workspace_id).select("*").single()
          : await db.from(table).insert(values).select("*").single();
        if (result.error) return json({ error: "Could not save business profile." }, result.error.code === "42501" ? 403 : 400, origin);
        return json({ record: result.data }, 200, origin);
      }
      return json({ error: "Unsupported business profile action." }, 400, origin);
    }
    if (action === "list") {
      const { data, error } = await db.from(table).select("*").eq("workspace_id", profile.workspace_id).order("created_at", { ascending: false }).limit(1000);
      if (error) return json({ error: "Could not load workspace records." }, error.code === "42501" ? 403 : 400, origin);
      return json({ records: data || [] }, 200, origin);
    }
    if (action === "create") {
      const values = { ...pick(body.values, fields), workspace_id: profile.workspace_id };
      const { data, error } = await db.from(table).insert(values).select("*").single();
      if (error) {
        const message = typeof error.message === "string" && /^(PLAN_LIMIT_REACHED|PLAN_FEATURE_LOCKED)\\|/.test(error.message)
          ? error.message
          : "Could not create record.";
        return json({ error: message }, error.code === "42501" ? 403 : 400, origin);
      }
      return json({ record: data }, 200, origin);
    }
    if (!isId(body.id)) return json({ error: "Invalid record id." }, 400, origin);
    if (action === "update") {
      const values = pick(body.values, fields);
      const { data, error } = await db.from(table).update(values).eq("id", body.id).eq("workspace_id", profile.workspace_id).select("*").maybeSingle();
      if (error) return json({ error: "Could not update record." }, error.code === "42501" ? 403 : 400, origin);
      if (!data) return json({ error: "Record not found or access denied." }, 404, origin);
      return json({ record: data }, 200, origin);
    }
    if (action === "delete") {
      const { data, error } = await db.from(table).delete().eq("id", body.id).eq("workspace_id", profile.workspace_id).select("id").maybeSingle();
      if (error) return json({ error: "Could not delete record." }, error.code === "42501" ? 403 : 400, origin);
      if (!data) return json({ error: "Record not found or access denied." }, 404, origin);
      return json({ ok: true, id: data.id }, 200, origin);
    }
    return json({ error: "Unsupported action." }, 400, origin);
  } catch (error) {
    console.error("workspace-records failed", error);
    return json({ error: "Something went wrong with workspace records." }, 500, origin);
  }
});
