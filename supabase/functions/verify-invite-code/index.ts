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
    const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!/^(MNG|S|SHOP|A)-WS-[0-9A-F-]{36}-[A-Z0-9]{6}$/.test(code)) return jsonResponse({ error: "Invalid code" }, 400, origin);
    const allowRebind = body?.allowRebind === true;

    const { data: invite, error: inviteError } = await auth.admin.from("invite_codes").select("*").eq("code", code).maybeSingle();
    if (inviteError) return jsonResponse({ error: "Could not verify invite" }, 500, origin);
    if (!invite || !invite.owner_id || !invite.membership_id) return jsonResponse({ error: "Invite not found" }, 404, origin);
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return jsonResponse({ error: "Invite expired" }, 409, origin);
    if (!auth.user.email || auth.user.email.toLowerCase() !== String(invite.email || "").toLowerCase()) return jsonResponse({ error: "Invite email does not match" }, 403, origin);
    if (invite.used_by || invite.used === true) return jsonResponse({ error: "Invite already used" }, 409, origin);
    if (!["manager", "employee", "storekeeper", "accountant"].includes(invite.role)) return jsonResponse({ error: "Invalid invite role" }, 403, origin);

    const { data: profile, error: profileError } = await auth.admin.from("profiles").select("role,workspace_id").eq("id", auth.user.id).maybeSingle();
    if (profileError) return jsonResponse({ error: "Could not load profile" }, 500, origin);
    if (profile?.workspace_id && profile.workspace_id !== invite.workspace_id) {
      const ownWorkspace = `WS-${auth.user.id.toUpperCase()}`;
      let blocked = !allowRebind;
      if (!blocked && profile.workspace_id === ownWorkspace) {
        const { count, error } = await auth.admin.from("workspace_members").select("id", { count: "exact", head: true })
          .eq("workspace_id", ownWorkspace).eq("owner_id", auth.user.id).neq("user_id", auth.user.id).neq("status", "removed");
        if (error) return jsonResponse({ error: "Could not check existing workspace members" }, 500, origin);
        blocked = (count || 0) > 0;
      }
      if (blocked) return jsonResponse({ error: "User already bound to another workspace" }, 409, origin);
    }

    // This endpoint uses service-role writes, which bypass row triggers.
    // Re-check feature and quota at acceptance time to close the invite race.
    const { data: teamAllowed, error: featureError } = await auth.admin.rpc("plan_feature_allowed", {
      p_workspace_id: invite.workspace_id,
      p_feature: "team",
    });
    if (featureError) return jsonResponse({ error: "Could not verify team access" }, 500, origin);
    if (!teamAllowed) return jsonResponse({ error: "PLAN_FEATURE_LOCKED|team|pro" }, 403, origin);
    const { data: plan, error: planError } = await auth.admin.rpc("current_plan", { p_workspace_id: invite.workspace_id });
    if (planError || !plan) return jsonResponse({ error: "Could not verify workspace plan" }, 500, origin);
    const { data: quota, error: quotaError } = await auth.admin.from("plan_limits")
      .select("max_count").eq("plan", plan).eq("resource", "team_members").maybeSingle();
    if (quotaError || !quota) return jsonResponse({ error: "Could not verify team quota" }, 500, origin);
    const { count: activeCount, error: countError } = await auth.admin.from("workspace_members")
      .select("id", { count: "exact", head: true }).eq("workspace_id", invite.workspace_id)
      .in("status", ["accepted", "active"]).neq("user_id", invite.owner_id);
    if (countError) return jsonResponse({ error: "Could not verify active team members" }, 500, origin);
    if (quota.max_count <= 0 || (activeCount || 0) >= quota.max_count) {
      return jsonResponse({ error: `PLAN_LIMIT_REACHED|team_members|${quota.max_count}|${plan}` }, 409, origin);
    }

    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await auth.admin.from("invite_codes")
      .update({ used: true, used_by: auth.user.id, used_at: now, updated_at: now })
      .eq("id", invite.id).eq("workspace_id", invite.workspace_id).eq("owner_id", invite.owner_id)
      .is("used_by", null).eq("used", false).select("id");
    if (claimError) return jsonResponse({ error: "Could not claim invite" }, 500, origin);
    if (!claimed?.length) return jsonResponse({ error: "Invite already used" }, 409, origin);

    const { data: member, error: memberError } = await auth.admin.from("workspace_members").select("id,revision")
      .eq("id", invite.membership_id).eq("workspace_id", invite.workspace_id).eq("owner_id", invite.owner_id).maybeSingle();
    if (memberError || !member) return jsonResponse({ error: "Membership not found" }, 404, origin);
    const { error: memberUpdateError } = await auth.admin.from("workspace_members").update({
      user_id: auth.user.id, status: "active", role: invite.role, revision: Number(member.revision || 0) + 1,
      accepted_at: now, activated_at: now, updated_at: now,
    }).eq("id", member.id).eq("workspace_id", invite.workspace_id).eq("owner_id", invite.owner_id);
    if (memberUpdateError) return jsonResponse({ error: "Could not activate membership" }, 500, origin);

    const { error: profileUpdateError } = await auth.admin.from("profiles").update({ role: invite.role, workspace_id: invite.workspace_id }).eq("id", auth.user.id);
    if (profileUpdateError) return jsonResponse({ error: "Membership activated, but profile update failed" }, 500, origin);
    const { error: logError } = await auth.admin.from("activity_logs").insert({
      event_key: crypto.randomUUID(), workspace_id: invite.workspace_id, owner_id: invite.owner_id,
      member_id: member.id, actor_id: auth.user.id, action: "applied", outcome: "applied", source: "verify-invite-code",
      metadata: { code, membershipId: member.id, role: invite.role },
    });
    if (logError) console.error("invite application log failed", { code: logError.code });
    return jsonResponse({ ok: true, role: invite.role, workspaceId: invite.workspace_id, membershipId: member.id, status: "active" }, 200, origin);
  } catch (error) {
    console.error("verify-invite-code failed", error);
    return jsonResponse({ error: "Something went wrong while verifying the invite." }, 500, origin);
  }
});
