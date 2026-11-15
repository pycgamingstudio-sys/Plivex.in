import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = new Set([
  "https://plivex.in",
  "https://www.plivex.in",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const allowedOrigin = (origin: string | null) => !origin || ALLOWED_ORIGINS.has(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:workers|pages)\.dev$/.test(origin);
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigin(origin) ? origin : "https://plivex.in",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const COUNTRY_SETTINGS: Record<string, { currency: string; locales: string[] }> = {
  IN: { currency: "INR", locales: ["en-IN", "hi-IN"] },
  US: { currency: "USD", locales: ["en-US", "es-US"] },
  GB: { currency: "GBP", locales: ["en-GB"] },
  AE: { currency: "AED", locales: ["en-AE", "ar-AE"] },
  CA: { currency: "CAD", locales: ["en-CA", "fr-CA"] },
  AU: { currency: "AUD", locales: ["en-AU"] },
  SG: { currency: "SGD", locales: ["en-SG", "zh-SG", "ms-SG", "ta-SG"] },
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!allowedOrigin(origin)) return json({ error: "Origin not allowed." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in." }, 401, origin);
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return json({ error: "Workspace country service is not configured." }, 503, origin);

    const authClient = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request body." }, 400, origin);
    const countryCode = typeof body.countryCode === "string" ? body.countryCode.trim().toUpperCase() : "";
    const localeCode = typeof body.localeCode === "string" ? body.localeCode.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;
    const settings = COUNTRY_SETTINGS[countryCode];
    if (!settings || !settings.locales.includes(localeCode)) return json({ error: "Choose a supported country and locale." }, 400, origin);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: membership, error: membershipError } = await admin
      .schema("global").from("workspace_members")
      .select("workspace_id, role, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (membershipError) {
      console.error("Global country membership lookup failed", { code: membershipError.code });
      return json({ error: "Could not verify your Global workspace." }, 503, origin);
    }
    if (!membership?.workspace_id) return json({ error: "Your Global workspace was not found." }, 404, origin);
    if (!["owner", "admin"].includes(membership.role)) return json({ error: "Only a workspace owner or admin can change its country." }, 403, origin);

    const { data, error } = await admin.schema("global").rpc("global_change_workspace_country", {
      p_user_id: user.id,
      p_workspace_id: membership.workspace_id,
      p_country_code: countryCode,
      p_locale_code: localeCode,
      p_currency_code: settings.currency,
      p_reason: reason,
    });
    if (error) {
      console.error("Global country update RPC failed", { code: error.code });
      return json({ error: "Country settings could not be saved. Please try again." }, 503, origin);
    }
    if (!data?.ok) {
      const messages: Record<string, string> = {
        workspace_admin_required: "Only a workspace owner or admin can change its country.",
        unsupported_country_currency: "The selected country currency is not supported.",
        unsupported_country_locale: "The selected language and country combination is not supported.",
        workspace_not_found: "Your Global workspace was not found.",
      };
      return json({ error: messages[data?.reason] || "Country settings could not be saved.", reason: data?.reason }, 400, origin);
    }
    return json({ ok: true, changed: data.changed === true, ...data }, 200, origin);
  } catch (error) {
    console.error("global-update-workspace-country failed", error);
    return json({ error: "Something went wrong while saving your workspace country." }, 500, origin);
  }
});
