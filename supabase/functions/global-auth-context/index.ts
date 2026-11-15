import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);

  try {
    const auth = await authenticateGlobal(req);
    if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);

    const { data, error } = await auth.admin.rpc("global_get_auth_context", { p_user_id: auth.user.id });
    if (error) {
      console.error("global-auth-context RPC failed", { code: error.code });
      return globalJson({ error: "Could not load your Global workspace." }, 500, origin);
    }

    const profile = data?.profile || null;
    const membership = data?.membership || null;
    const workspace = data?.workspace || null;
    const globalRole = membership?.role || null;
    const role = globalRole === "owner" ? "admin" : globalRole;

    return globalJson({
      user: {
        id: auth.user.id,
        email: auth.user.email || profile?.email || "",
        full_name: profile?.full_name || auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || "",
        role,
        global_role: globalRole,
        workspace_id: membership?.workspace_id || null,
        workspace_name: workspace?.name || "",
        country_code: workspace?.country_code || null,
        locale_code: workspace?.locale_code || null,
        currency_code: workspace?.currency_code || null,
        user_ref: null,
        created_date: profile?.created_at || auth.user.created_at,
        profilePicture: profile?.avatar_url || "",
        phone: profile?.phone || "",
      },
    }, 200, origin);
  } catch (error) {
    console.error("global-auth-context failed", error);
    return globalJson({ error: "Something went wrong while loading your Global account." }, 500, origin);
  }
});
