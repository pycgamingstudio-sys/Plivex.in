import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);

  try {
    const auth = await authenticateGlobal(req);
    if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);
    const body = await req.json().catch(() => ({}));
    const fullName = body?.full_name === undefined ? null : body.full_name;
    const avatarUrl = body?.avatar_url === undefined ? null : body.avatar_url;
    const phone = body?.phone === undefined ? null : body.phone;

    if (fullName !== null && (typeof fullName !== "string" || fullName.trim().length > 160)) {
      return globalJson({ error: "Display name must be 160 characters or fewer." }, 400, origin);
    }
    if (avatarUrl !== null && (typeof avatarUrl !== "string" || avatarUrl.length > 700000)) {
      return globalJson({ error: "Profile image is too large or invalid." }, 400, origin);
    }
    if (phone !== null && (typeof phone !== "string" || phone.trim().length > 40)) {
      return globalJson({ error: "Enter a valid phone number." }, 400, origin);
    }

    const { data, error } = await auth.admin.rpc("global_update_user_profile", {
      p_user_id: auth.user.id,
      p_full_name: fullName,
      p_avatar_url: avatarUrl,
      p_phone: phone,
    });
    if (error) {
      console.error("global profile update RPC failed", { code: error.code });
      return globalJson({ error: "Could not update your Global profile." }, 500, origin);
    }
    if (!data?.ok) return globalJson({ error: "Your Global profile was not found." }, 404, origin);
    return globalJson({ ok: true, profile: data }, 200, origin);
  } catch (error) {
    console.error("global-update-profile failed", error);
    return globalJson({ error: "Something went wrong while updating your Global profile." }, 500, origin);
  }
});
