import { authenticate, corsHeaders, isAllowedOrigin, jsonResponse } from "../_shared/team.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);
  try {
    const auth = await authenticate(req);
    if ("error" in auth) return jsonResponse({ error: auth.error }, auth.status, origin);
    const body = await req.json().catch(() => ({}));
    const reset = body?.reset === true;
    let { data: profile, error: profileError } = await auth.admin.from("profiles")
      .select("id,email,role,workspace_id").eq("id", auth.user.id).maybeSingle();
    if (profileError) return jsonResponse({ error: "Could not load profile" }, 500, origin);

    // An authenticated standalone signup may provision its own first workspace.
    // Existing invited members are protected from accidental owner-workspace creation.
    const { data: invite, error: inviteError } = await auth.admin.from("invite_codes").select("id").eq("used_by", auth.user.id).limit(1);
    if (inviteError) return jsonResponse({ error: "Could not check invite history" }, 500, origin);
    if (invite?.length) return jsonResponse({ ok: true, skipped: true, role: profile?.role || "employee", workspaceId: profile?.workspace_id || null }, 200, origin);

    if (!profile) {
      const email = String(auth.user.email || "").trim().toLowerCase();
      const { error: createProfileError } = await auth.admin.from("profiles").insert({
        id: auth.user.id, email, role: "admin", workspace_id: null,
        full_name: String(auth.user.user_metadata?.full_name || "").trim().slice(0, 160) || null,
      });
      if (createProfileError && createProfileError.code !== "23505") {
        return jsonResponse({ error: "Could not initialize your workspace profile" }, 500, origin);
      }
      const refreshed = await auth.admin.from("profiles").select("id,email,role,workspace_id")
        .eq("id", auth.user.id).maybeSingle();
      if (refreshed.error || !refreshed.data) return jsonResponse({ error: "Could not verify your workspace profile" }, 500, origin);
      profile = refreshed.data;
    }
    if (profile.role !== "admin" && profile.workspace_id) {
      return jsonResponse({ ok: true, skipped: true, role: profile.role, workspaceId: profile.workspace_id }, 200, origin);
    }
    if (profile.workspace_id && !reset) {
      const [{ data: existingBusinessProfile, error: existingBusinessProfileError }, { data: existingSettings, error: existingSettingsError }] = await Promise.all([
        auth.admin.from("business_profile").select("country_code").eq("workspace_id", profile.workspace_id).maybeSingle(),
        auth.admin.from("workspace_settings").select("country_code").eq("workspace_id", profile.workspace_id).maybeSingle(),
      ]);
      if (existingBusinessProfileError || existingSettingsError) return jsonResponse({ error: "Could not verify the existing workspace settings." }, 500, origin);
      if (existingBusinessProfile?.country_code && existingSettings?.country_code) {
        return jsonResponse({ ok: true, skipped: true, role: profile.role, workspaceId: profile.workspace_id }, 200, origin);
      }
      // Legacy or partially provisioned workspaces are completed in place; no second workspace is created.
    }

    const email = String(profile?.email || auth.user.email || "").trim().toLowerCase();
    const metadata = auth.user.user_metadata || {};
    const countryLocales: Record<string, string[]> = {
      IN: ["en-IN", "hi-IN"], US: ["en-US", "es-US"], GB: ["en-GB"],
      AE: ["en-AE", "ar-AE"], CA: ["en-CA", "fr-CA"], AU: ["en-AU"],
      SG: ["en-SG", "zh-SG", "ms-SG", "ta-SG"],
    };
    const requestedCountryValue = typeof body?.countryCode === "string" ? body.countryCode : metadata.signup_country_code;
    const requestedLocaleValue = typeof body?.localeCode === "string" ? body.localeCode : metadata.signup_locale_code;
    const countryCode = typeof requestedCountryValue === "string" ? requestedCountryValue.trim().toUpperCase() : "";
    const localeCode = typeof requestedLocaleValue === "string" ? requestedLocaleValue.trim() : "";
    if (!countryLocales[countryCode]) return jsonResponse({ error: "Choose a supported business country before creating your workspace." }, 400, origin);
    if (!countryLocales[countryCode].includes(localeCode)) return jsonResponse({ error: "Choose a valid regional format for your selected country." }, 400, origin);
    const workspaceType = String(body?.businessType || metadata.plivex_work_type || "").trim().toLowerCase();
    if (!["freelancer", "business"].includes(workspaceType)) return jsonResponse({ error: "Choose Freelancer or Business for your workspace." }, 400, origin);
    const allowedFeatures = new Set(["expenses", "crm", "leads", "inventoryWorkspace", "reports"]);
    const requestedFeatures = Array.isArray(body?.optionalFeatures) ? body.optionalFeatures : metadata.plivex_workspace_features;
    const optionalFeatures = Array.isArray(requestedFeatures)
      ? [...new Set(requestedFeatures.filter((value: unknown): value is string => typeof value === "string" && allowedFeatures.has(value)))]
      : [];
    const currencyByCountry: Record<string, string> = { IN: "INR", US: "USD", GB: "GBP", AE: "AED", CA: "CAD", AU: "AUD", SG: "SGD" };
    const phoneCodeByCountry: Record<string, string> = { IN: "+91", US: "+1", GB: "+44", AE: "+971", CA: "+1", AU: "+61", SG: "+65" };
    const workspaceId = profile?.workspace_id || `WS-${auth.user.id.toUpperCase()}`;
    const now = new Date().toISOString();
    const { error: upsertProfileError } = await auth.admin.from("profiles").upsert({
      id: auth.user.id, email, role: "admin", workspace_id: workspaceId,
      country_code: countryCode, locale_code: localeCode,
      full_name: String(body?.businessName || metadata.full_name || metadata.name || "").trim().slice(0, 160) || null,
      updated_at: now,
    }, { onConflict: "id" });
    if (upsertProfileError) return jsonResponse({ error: "Could not update owner profile" }, 500, origin);

    const { error: memberError } = await auth.admin.from("workspace_members").upsert({
      membership_key: `${workspaceId}:${email}`, workspace_id: workspaceId, owner_id: auth.user.id,
      email, user_id: auth.user.id, role: "admin", status: "active", updated_at: now,
    }, { onConflict: "membership_key" });
    if (memberError) return jsonResponse({ error: "Could not create owner membership" }, 500, origin);

    // Persist the manually selected country and regional identity on the workspace.
    const { error: countryError } = await auth.admin.from("business_profile").upsert({
      workspace_id: workspaceId,
      country_code: countryCode,
      locale_code: localeCode,
      phone: String(metadata.phone || "").trim() ? `${phoneCodeByCountry[countryCode]} ${String(metadata.phone).trim().slice(0, 32)}` : null,
      name: String(body?.businessName || metadata.full_name || metadata.name || "").trim().slice(0, 160) || null,
    }, { onConflict: "workspace_id" });
    if (countryError) {
      console.error("Owner workspace country setup failed", { code: countryError.code });
      return jsonResponse({ error: "Workspace created, but regional settings could not be initialized. Please save them in Workspace Settings." }, 500, origin);
    }

    const { error: settingsError } = await auth.admin.from("workspace_settings").upsert({
      workspace_id: workspaceId,
      country_code: countryCode,
      locale_code: localeCode,
      currency_code: currencyByCountry[countryCode],
      workspace_type: workspaceType,
      optional_features: optionalFeatures,
      phone_country_code: phoneCodeByCountry[countryCode],
      phone_number: String(metadata.phone || "").trim().slice(0, 32) || null,
      created_by: auth.user.id,
      updated_at: now,
    }, { onConflict: "workspace_id" });
    if (settingsError) {
      console.error("Workspace settings setup failed", { code: settingsError.code });
      return jsonResponse({ error: "Workspace settings could not be saved. Please retry setup." }, 500, origin);
    }

    // Current Plivex uses a Free plan; intentionally do not create the archived 14-day trial fields.
    return jsonResponse({ ok: true, role: "admin", workspaceId, countryCode, localeCode }, 200, origin);
  } catch (error) {
    console.error("ensure-owner-role failed", error);
    return jsonResponse({ error: "Could not initialize workspace owner." }, 500, origin);
  }
});
