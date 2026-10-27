import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = new Set([
  "https://plivex.in",
  "https://www.plivex.in",
  "https://plivex.netlify.app",
]);
const isAllowedOrigin = (origin: string | null) =>
  !origin || ALLOWED_ORIGINS.has(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.workers\.dev$/.test(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.pages\.dev$/.test(origin);

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && isAllowedOrigin(origin) ? origin : "https://plivex.in",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Please sign in to view workspace members." }, 401, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "Team service is not configured." }, 503, origin);

  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("workspace_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !profile?.workspace_id) {
      return json({ error: "Your Plivex workspace could not be found." }, 403, origin);
    }

    const { data, error } = await supabase
      .from("workspace_members")
      .select("id, membership_key, workspace_id, owner_id, user_id, name, email, role, status, invited_at, accepted_at, activated_at, removed_at, invite_delivery, created_at, updated_at")
      .eq("workspace_id", profile.workspace_id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("get-workspace-team query failed", { code: error.code, userId: user.id });
      return json({ error: "Could not load workspace members. Check workspace permissions." }, error.code === "42501" ? 403 : 400, origin);
    }

    const members = (data || []).map((member) => ({
      id: member.id,
      membershipKey: member.membership_key,
      workspaceId: member.workspace_id,
      ownerId: member.owner_id,
      userId: member.user_id,
      name: member.name || "",
      email: member.email,
      role: member.role,
      status: member.status,
      invitedAt: member.invited_at,
      acceptedAt: member.accepted_at,
      activatedAt: member.activated_at,
      removedAt: member.removed_at,
      inviteDelivery: member.invite_delivery,
      createdAt: member.created_at,
      updatedAt: member.updated_at,
    }));

    return json({
      schemaVersion: 1,
      workspaceId: profile.workspace_id,
      members,
      requestId: crypto.randomUUID(),
    }, 200, origin);
  } catch (error) {
    console.error("get-workspace-team failed", error);
    return json({ error: "Something went wrong while loading workspace members." }, 500, origin);
  }
});
