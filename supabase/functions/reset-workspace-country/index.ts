import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const isAllowedOrigin = (origin: string | null) => !origin || ORIGINS.has(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.workers\.dev$/.test(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.pages\.dev$/.test(origin);
const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && isAllowedOrigin(origin) ? origin : "https://plivex.in",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const jsonResponse = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin not allowed." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Please sign in." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return jsonResponse({ error: "Workspace service is not configured." }, 503, origin);

  try {
    const authClient = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error } = await authClient.auth.getUser();
    if (error || !user) return jsonResponse({ error: "Your session expired. Please sign in again." }, 401, origin);

    // PLIVEX ONE keeps a single Workspace identity. This endpoint must never
    // delete/recreate tenant data or change the manually selected country.
    return jsonResponse({
      error: "Workspace country is fixed after onboarding. Contact support for a reviewed migration; no business data was changed.",
    }, 409, origin);
  } catch (error) {
    console.error("reset-workspace-country disabled endpoint failed", error);
    return jsonResponse({ error: "Workspace country changes are disabled; no business data was changed." }, 500, origin);
  }
});
