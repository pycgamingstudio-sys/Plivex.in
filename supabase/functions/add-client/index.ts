import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = new Set([
  "https://plivex.in",
  "https://www.plivex.in",
  "https://plivex.netlify.app",
]);
const isAllowedOrigin = (origin: string | null) => !origin || ALLOWED_ORIGINS.has(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.workers\.dev$/.test(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.pages\.dev$/.test(origin);
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && isAllowedOrigin(origin) ? origin : "https://plivex.in",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in to add a client." }, 401, origin);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "Client service is not configured." }, 503, origin);

  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);

    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("workspace_id,role").eq("id", user.id).maybeSingle();
    if (profileError || !profile?.workspace_id) return json({ error: "Your Plivex workspace could not be found." }, 403, origin);

    const body = await req.json().catch(() => null);
    const name = clean(body?.name, 120);
    if (!name) return json({ error: "Client name is required." }, 400, origin);
    const email = clean(body?.email, 180);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Enter a valid client email address." }, 400, origin);
    }
    const gstin = clean(body?.gstin, 30).toUpperCase();
    if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) {
      return json({ error: "GSTIN must contain 15 letters or numbers." }, 400, origin);
    }

    const { data, error } = await supabase.from("clients").insert({
      workspace_id: profile.workspace_id,
      name,
      company: clean(body?.company, 120) || null,
      email: email || null,
      phone: clean(body?.phone, 40) || null,
      gstin: gstin || null,
      address: clean(body?.address, 400) || null,
    }).select("id,name,company,email,phone,gstin,address,created_at").single();

    if (error) {
      console.error("add-client insert failed", { code: error.code, userId: user.id });
      if (error.code === "42501") return json({ error: "Your Plivex role does not have permission to add clients." }, 403, origin);
      if (error.code === "23505") return json({ error: "This client already exists." }, 409, origin);
      if (error.code === "23502") return json({ error: "A required client field is missing." }, 400, origin);
      if (typeof error.message === "string" && (error.message.startsWith("PLAN_LIMIT_REACHED|") || error.message.startsWith("PLAN_FEATURE_LOCKED|"))) {
        return json({ error: error.message }, 409, origin);
      }
      return json({ error: "Could not save the client. Please check the details and try again." }, 400, origin);
    }
    return json({ ok: true, client: data }, 201, origin);
  } catch (error) {
    console.error("add-client failed", error);
    return json({ error: "Something went wrong while adding the client. Please try again." }, 500, origin);
  }
});