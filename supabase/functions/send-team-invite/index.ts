import { authenticate, corsHeaders, getAdminScope, isAllowedOrigin, jsonResponse } from "../_shared/team.ts";

const STAFF_ROLES = ["manager", "employee", "storekeeper", "accountant"] as const;
const PREFIX: Record<string, string> = { manager: "MNG", employee: "S", storekeeper: "SHOP", accountant: "A" };
const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALNUM[b % ALNUM.length]).join("");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);
  try {
    const auth = await authenticate(req);
    if ("error" in auth) return jsonResponse({ error: auth.error }, auth.status, origin);
    const scope = await getAdminScope(auth.admin, auth.user.id);
    if (!scope) return jsonResponse({ error: "Admin only", operation: "send-team-invite" }, 403, origin);
    const body = await req.json().catch(() => ({}));
    const to = typeof body?.to === "string" ? body.to.trim().toLowerCase() : "";
    const name = body?.name == null ? null : typeof body.name === "string" ? body.name.trim() : undefined;
    const role = body?.role;
    if (!EMAIL_RE.test(to) || to.length > 254) return jsonResponse({ error: "Invalid email" }, 400, origin);
    if (!STAFF_ROLES.includes(role)) return jsonResponse({ error: "Invalid role" }, 400, origin);
    if (name === undefined || (name && name.length > 100)) return jsonResponse({ error: "Invalid name" }, 400, origin);
    if (body?.workspaceName != null && (typeof body.workspaceName !== "string" || body.workspaceName.length > 100)) return jsonResponse({ error: "Invalid workspaceName" }, 400, origin);

    const key = `${scope.workspaceId}:${to}`;
    const { data: existing, error: findError } = await auth.admin.from("workspace_members").select("id,status,revision")
      .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.ownerId).eq("membership_key", key).maybeSingle();
    if (findError) return jsonResponse({ error: "Could not check existing member" }, 500, origin);
    if (existing?.status === "active") return jsonResponse({ error: "Already an active member" }, 409, origin);
    const now = new Date().toISOString();
    const row = { role, name, email: to, status: "invited", invite_delivery: "failed", user_id: null, invited_at: now, updated_at: now };
    const saved = existing
      ? await auth.admin.from("workspace_members").update({ ...row, revision: Number(existing.revision || 0) + 1, removed_at: null })
          .eq("id", existing.id).eq("workspace_id", scope.workspaceId).eq("owner_id", scope.ownerId).select("id").single()
      : await auth.admin.from("workspace_members").insert({ ...row, membership_key: key, workspace_id: scope.workspaceId, owner_id: scope.ownerId })
          .select("id").single();
    if (saved.error || !saved.data) return jsonResponse({ error: "Could not save member" }, 500, origin);
    const membershipId = saved.data.id;

    let code = "";
    let created = false;
    for (let i = 0; i < 5; i++) {
      code = `${PREFIX[role]}-${scope.workspaceId}-${randomCode()}`;
      const { error } = await auth.admin.from("invite_codes").insert({
        code, workspace_id: scope.workspaceId, owner_id: scope.ownerId, membership_id: membershipId,
        email: to, role, created_by: auth.user.id, used: false,
      });
      if (!error) { created = true; break; }
    }
    if (!created) return jsonResponse({ error: "Could not create invite code" }, 500, origin);

    // The recovered original sender depends on Lovable's connector gateway.
    // Do not call that gateway from the replacement function; return a shareable code until mail is migrated.
    const { error: logError } = await auth.admin.from("activity_logs").insert({
      event_key: crypto.randomUUID(), workspace_id: scope.workspaceId, owner_id: scope.ownerId, member_id: membershipId,
      actor_id: auth.user.id, action: "invite_sent", outcome: "applied", source: "send-team-invite",
      metadata: { to, role, membershipId, workspaceName: typeof body.workspaceName === "string" ? body.workspaceName : null, emailSent: false },
    });
    if (logError) console.error("invite activity log failed", { code: logError.code });
    return jsonResponse({ ok: true, sentTo: to, code, membershipId, emailSent: false,
      warning: "Email delivery is not configured yet. Share this invite code with the member manually." }, 200, origin);
  } catch (error) {
    console.error("send-team-invite failed", error);
    return jsonResponse({ error: "Something went wrong while creating the invite." }, 500, origin);
  }
});
