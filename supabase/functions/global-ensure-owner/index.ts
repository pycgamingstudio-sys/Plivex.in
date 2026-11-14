import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

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
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);

  try {
    const auth = await authenticateGlobal(req);
    if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);
    const body = await req.json().catch(() => ({}));
    const metadata = auth.user.user_metadata || {};
    const countryValue = typeof body?.countryCode === "string" ? body.countryCode : metadata.signup_country_code;
    const localeValue = typeof body?.localeCode === "string" ? body.localeCode : metadata.signup_locale_code;
    const countryCode = typeof countryValue === "string" && countryValue.trim() ? countryValue.trim().toUpperCase() : "";
    if (!countryCode) return globalJson({ error: "Choose your business country before creating your workspace." }, 400, origin);
    const settings = COUNTRY_SETTINGS[countryCode];
    if (!settings) return globalJson({ error: "Choose a supported Global business country." }, 400, origin);
    const localeCode = typeof localeValue === "string" && localeValue.trim()
      ? localeValue.trim() : settings.locales[0];
    if (!settings.locales.includes(localeCode)) {
      return globalJson({ error: "Choose a language and locale supported by the selected country." }, 400, origin);
    }

    const fullName = String(metadata.full_name || metadata.name || "").trim().slice(0, 160);
    const { data, error } = await auth.admin.rpc("global_provision_owner_workspace", {
      p_user_id: auth.user.id,
      p_email: auth.user.email || "",
      p_full_name: fullName,
      p_country_code: countryCode,
      p_locale_code: localeCode,
      p_currency_code: settings.currency,
    });
    if (error) {
      console.error("global owner provisioning RPC failed", { code: error.code });
      return globalJson({ error: "Could not initialize your Global workspace." }, 500, origin);
    }
    if (!data?.ok) {
      const status = data?.reason === "membership_requires_review" ? 409 : 400;
      const message = data?.reason === "membership_requires_review"
        ? "A pending or suspended Global workspace membership needs review. You cannot create a separate owner workspace."
        : data?.reason === "unsupported_country_locale_currency"
          ? "The selected country, locale and currency combination is not supported."
          : "Your Global workspace could not be initialized.";
      return globalJson({ error: message, reason: data?.reason }, status, origin);
    }

    return globalJson({
      ok: true,
      created: data.created === true,
      workspaceId: data.workspace_id,
      role: data.role,
      countryCode: data.country_code,
      localeCode: data.locale_code,
      currencyCode: data.currency_code,
    }, 200, origin);
  } catch (error) {
    console.error("global-ensure-owner failed", error);
    return globalJson({ error: "Something went wrong while initializing your Global workspace." }, 500, origin);
  }
});
