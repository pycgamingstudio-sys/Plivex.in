import { authenticate, corsHeaders, getAdminScope, isAllowedOrigin, jsonResponse } from "../_shared/team.ts";

const STAFF_ROLES = ["manager", "employee", "storekeeper", "accountant"] as const;
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  try {
    const auth = await authenticate(req);
    if ("error" in auth) return jsonResponse({ error: auth.error }, auth.status, origin);
    const scope = await getAdminScope(auth.admin, auth.user.id);
    if (!scope) return jsonResponse({ error: "Admin only", operation: "manage-workspace-member" }, 403, origin);
    const body = await req.json().catch(() => ({}));
    const memberId = typeof body?.memberId === "string" ? body.memberId : "";
    const action = body?.action;
    const role = body?.role;
    if (!/^[0-9a-f-]{36}$/i.test(memberId)) return jsonResponse({ error: "Invalid memberId" }, 400, origin);
    if (action !== "changeRole" && action !== "remove") return jsonResponse({ error: "Invalid action" }, 400, origin);
    if (action === "changeRole" && !STAFF_ROLES.includes(role)) return jsonResponse({ error: "Invalid role" }, 400, origin);

    const { data: member, error: readError } = await auth.admin.from("workspace_members")
      .select("id,user_id,role,status,revision")
      .eq("id", memberId).eq("workspace_id", scope.workspaceId).eq("owner_id", scope.ownerId).maybeSingle();
    if (readError) return jsonResponse({ error: "Could not load member" }, 500, origin);
    if (!member) return jsonResponse({ error: "Member not found" }, 404, origin);
    if (member.id === scope.ownerRowId || member.user_id === scope.ownerId) return jsonResponse({ error: "Owner cannot be edited or removed" }, 403, origin);
    if (member.status === "removed") return jsonResponse({ error: "Member already removed" }, 409, origin);

    const now = new Date().toISOString();
    const revision = Number(member.revision || 0) + 1;
    const patch = action === "remove"
      ? { status: "removed", removed_at: now, revision, updated_at: now }
      : { role, revision, updated_at: now };
    const { error: updateError } = await auth.admin.from("workspace_members").update(patch)
      .eq("id", member.id).eq("workspace_id", scope.workspaceId).eq("owner_id", scope.ownerId);
    if (updateError) return jsonResponse({ error: "Could not update member" }, 500, origin);

    if (member.user_id) {
      const profilePatch = action === "remove" ? { role: "employee", workspace_id: null } : { role };
      const { error } = await auth.admin.from("profiles").update(profilePatch).eq("id", member.user_id).eq("workspace_id", scope.workspaceId);
      if (error) return jsonResponse({ error: "Member record updated, but profile synchronization failed" }, 500, origin);
    }

    const { error: logError } = await auth.admin.from("activity_logs").insert({
      event_key: crypto.randomUUID(), workspace_id: scope.workspaceId, owner_id: scope.ownerId, member_id: member.id,
      actor_id: auth.user.id, action: action === "remove" ? "member_removed" : "member_role_changed",
      from_role: member.role, to_role: action === "changeRole" ? role : null,
      outcome: "applied", source: "manage-workspace-member",
      metadata: { memberId: member.id, from: member.role, to: action === "changeRole" ? role : null, revision },
    });
    if (logError) console.error("member activity log failed", { code: logError.code });

    return jsonResponse({ ok: true, memberId: member.id, action, role: action === "changeRole" ? role : member.role,
      status: action === "remove" ? "removed" : member.status, revision }, 200, origin);
  } catch (error) {
    console.error("manage-workspace-member failed", error);
    return jsonResponse({ error: "Something went wrong while managing the workspace member." }, 500, origin);
  }
});
