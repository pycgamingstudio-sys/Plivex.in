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
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin not allowed." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);

  try {
    const auth = await authenticate(req);
    if ("error" in auth) return jsonResponse({ error: auth.error }, auth.status, origin);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "Invalid request body." }, 400, origin);
    }
    if (body.confirmationPhrase !== "DELETE_MY_BUSINESS_DATA") {
      return jsonResponse({ error: "Explicit country-reset confirmation is required." }, 400, origin);
    }

    const countryCode = typeof body.countryCode === "string" ? body.countryCode.trim().toUpperCase() : "";
    const localeCode = typeof body.localeCode === "string" ? body.localeCode.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;
    const settings = COUNTRY_SETTINGS[countryCode];
    if (!settings || !settings.locales.includes(localeCode)) {
      return jsonResponse({ error: "Choose a supported country and locale." }, 400, origin);
    }

    const { data, error } = await auth.admin.rpc("reset_workspace_country_atomic", {
      p_user_id: auth.user.id,
      p_country_code: countryCode,
      p_locale_code: localeCode,
      p_currency_code: settings.currency,
      p_reason: reason,
    });

    if (error) {
      console.error("Atomic workspace country reset failed", { code: error.code });
      return jsonResponse({
        error: "Country reset could not be completed. No partial workspace reset was committed.",
      }, 503, origin);
    }

    if (!data?.ok) {
      const reasonMessages: Record<string, string> = {
        user_required: "Please sign in again.",
        auth_user_not_found: "Your account could not be verified.",
        unsupported_country_locale_currency: "The selected country, language and currency combination is not supported.",
        workspace_owner_required: "Only the workspace owner can permanently reset business data.",
        workspace_not_found: "Your current workspace could not be verified.",
        active_owner_workspace_required: "An active owner workspace is required before changing country.",
        legacy_global_membership_requires_review: "An older inactive Global membership needs support review. No data was deleted.",
        conflicting_workspace_memberships: "Your account has conflicting India and Global workspace links. No data was deleted; support must verify the account first.",
        same_country: "Your selected country is already active. Change only the language setting instead.",
      };
      const status = data.reason === "workspace_owner_required" ? 403
        : data.reason === "cooldown_active" ? 429
        : data.reason === "active_owner_workspace_required" || data.reason === "legacy_global_membership_requires_review" || data.reason === "conflicting_workspace_memberships" ? 409
        : 400;
      return jsonResponse({
        error: data.reason === "cooldown_active"
          ? "Country changes are temporarily locked. Please try again after the cooldown."
          : reasonMessages[data.reason] || "Country reset could not be completed.",
        reason: data.reason,
        retryAfter: data.retry_after || null,
      }, status, origin);
    }

    return jsonResponse({
      ok: true,
      changed: true,
      countryCode: data.country_code,
      localeCode: data.locale_code,
      currencyCode: data.currency_code,
      workspaceId: data.workspace_id,
      cooldownDays: data.cooldown_days,
    }, 200, origin);
  } catch (error) {
    console.error("reset-workspace-country failed", error);
    return jsonResponse({ error: "Something went wrong. Please retry or contact support." }, 500, origin);
  }
});
