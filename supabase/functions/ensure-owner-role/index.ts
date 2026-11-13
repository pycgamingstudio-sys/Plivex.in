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
    const { data: profile, error: profileError } = await auth.admin.from("profiles")
      .select("id,email,role,workspace_id").eq("id", auth.user.id).maybeSingle();
    if (profileError) return jsonResponse({ error: "Could not load profile" }, 500, origin);

    // This endpoint must never bootstrap an arbitrary signed-in user into admin.
    // Only an already-provisioned admin profile may initialize/repair its own workspace.
    if (!profile) return jsonResponse({ error: "Owner account is not provisioned. Contact Plivex support." }, 403, origin);
    if (profile.role !== "admin") return jsonResponse({ ok: true, skipped: true, role: profile.role, workspaceId: profile.workspace_id }, 200, origin);
    if (profile.workspace_id && !reset) return jsonResponse({ ok: true, skipped: true, role: profile.role, workspaceId: profile.workspace_id }, 200, origin);

    const { data: invite, error: inviteError } = await auth.admin.from("invite_codes").select("id").eq("used_by", auth.user.id).limit(1);
    if (inviteError) return jsonResponse({ error: "Could not check invite history" }, 500, origin);
    if (invite?.length) return jsonResponse({ ok: true, skipped: true, role: profile?.role || "employee", workspaceId: profile?.workspace_id || null }, 200, origin);

    const email = String(profile?.email || auth.user.email || "").trim().toLowerCase();
    const workspaceId = profile?.workspace_id || `WS-${auth.user.id.toUpperCase()}`;
    const now = new Date().toISOString();
    const { error: upsertProfileError } = await auth.admin.from("profiles").upsert({
      id: auth.user.id, email, role: "admin", workspace_id: workspaceId, updated_at: now,
    }, { onConflict: "id" });
    if (upsertProfileError) return jsonResponse({ error: "Could not update owner profile" }, 500, origin);

    const { error: memberError } = await auth.admin.from("workspace_members").upsert({
      membership_key: `${workspaceId}:${email}`, workspace_id: workspaceId, owner_id: auth.user.id,
      email, user_id: auth.user.id, role: "admin", status: "active", updated_at: now,
    }, { onConflict: "membership_key" });
    if (memberError) return jsonResponse({ error: "Could not create owner membership" }, 500, origin);

    // Persist the explicit signup country/locale on the new workspace.
    // Invited members never reach this owner-bootstrap path.
    const metadata = auth.user.user_metadata || {};
    const countryLocales: Record<string, string[]> = {
      IN: ["en-IN", "hi-IN"], US: ["en-US", "es-US"], GB: ["en-GB"],
      AE: ["en-AE", "ar-AE"], CA: ["en-CA", "fr-CA"], AU: ["en-AU"],
      SG: ["en-SG", "zh-SG", "ms-SG", "ta-SG"],
    };
    const requestedCountry = typeof metadata.signup_country_code === "string" ? metadata.signup_country_code.toUpperCase() : "IN";
    const requestedLocale = typeof metadata.signup_locale_code === "string" ? metadata.signup_locale_code : "en-IN";
    const countryCode = countryLocales[requestedCountry]?.includes(requestedLocale) ? requestedCountry : "IN";
    const localeCode = countryLocales[countryCode]?.includes(requestedLocale) ? requestedLocale : "en-IN";
    const { error: countryError } = await auth.admin.from("business_profile").upsert({
      workspace_id: workspaceId, country_code: countryCode, locale_code: localeCode,
    }, { onConflict: "workspace_id", ignoreDuplicates: true });
    if (countryError) {
      console.error("Owner workspace country setup failed", { code: countryError.code });
      return jsonResponse({ error: "Workspace created, but regional settings could not be initialized. Please save them in Workspace Settings." }, 500, origin);
    }

    // Current Plivex uses a Free plan; intentionally do not create the archived 14-day trial fields.
    return jsonResponse({ ok: true, role: "admin", workspaceId, countryCode, localeCode }, 200, origin);
  } catch (error) {
    console.error("ensure-owner-role failed", error);
    return jsonResponse({ error: "Could not initialize workspace owner." }, 500, origin);
  }
});
