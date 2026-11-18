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

async function authenticate(req: Request): Promise<{ user: any; admin: any } | { error: string; status: number }> {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return { error: "Please sign in.", status: 401 };
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return { error: "Workspace service is not configured.", status: 503 };
  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error || !user) return { error: "Your session expired. Please sign in again.", status: 401 };
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  return { user, admin };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin not allowed." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);

  try {
    const auth = await authenticate(req);
    if ("error" in auth) return jsonResponse({ error: auth.error }, auth.status, origin);

    const body = await req.json().catch(() => null);
    const localeCode = typeof body?.localeCode === "string" ? body.localeCode.trim() : "";
    const { data, error } = await auth.admin.rpc("update_workspace_locale_atomic", {
      p_user_id: auth.user.id,
      p_locale_code: localeCode,
    });
    if (error) {
      console.error("Workspace locale update failed", { code: error.code });
      return jsonResponse({ error: "Workspace language could not be saved." }, 503, origin);
    }
    if (!data?.ok) {
      const status = data?.reason === "workspace_owner_required" ? 403
        : data?.reason === "unsupported_locale" ? 400 : 409;
      return jsonResponse({
        error: data?.reason === "unsupported_locale"
          ? "Choose a locale supported by your selected Workspace country."
          : "Only the Workspace owner can update this language setting.",
        reason: data?.reason,
      }, status, origin);
    }
    return jsonResponse({ ok: true, countryCode: data.country_code, localeCode: data.locale_code }, 200, origin);
  } catch (error) {
    console.error("update-workspace-locale failed", error);
    return jsonResponse({ error: "Something went wrong. Please retry." }, 500, origin);
  }
});
