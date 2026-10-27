import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const isAllowedOrigin = (origin: string | null) => !origin || ALLOWED_ORIGINS.has(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.workers\.dev$/.test(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.pages\.dev$/.test(origin);
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && isAllowedOrigin(origin) ? origin : "https://plivex.in",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in to view workspace members." }, 401, origin);
  const supabaseUrl = Deno.env.get("SUPABASE_URL"), anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "Team service is not configured." }, 503, origin);

  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);

    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("role,workspace_id").eq("id", user.id).maybeSingle();
    if (profileError || profile?.role !== "admin" || !profile.workspace_id) {
      return json({ error: "Admin only" }, 403, origin);
    }
    const { data: ownerRow, error: ownerError } = await supabase.from("workspace_members")
      .select("id,owner_id").eq("workspace_id", profile.workspace_id).eq("role", "admin")
      .not("owner_id", "is", null).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (ownerError || !ownerRow?.owner_id) return json({ error: "Workspace owner could not be resolved." }, 403, origin);

    const { data: members, error } = await supabase.from("workspace_members")
      .select("id,membership_key,workspace_id,owner_id,user_id,name,email,role,status,invited_at,accepted_at,activated_at,removed_at,invite_delivery,revision,created_at,updated_at")
      .eq("workspace_id", profile.workspace_id).eq("owner_id", ownerRow.owner_id).neq("status", "removed")
      .order("created_at", { ascending: true }).limit(1000);
    if (error) {
      console.error("get-workspace-team query failed", { code: error.code, userId: user.id });
      return json({ error: "Could not load workspace members." }, error.code === "42501" ? 403 : 400, origin);
    }
    const list = (members || []).map((m) => ({ ...m, isOwner: m.id === ownerRow.id }));
    const counts = { admin: 0, manager: 0, employee: 0, storekeeper: 0, accountant: 0, pending: 0, accepted: 0, active: 0 };
    for (const m of list) {
      if (m.role in counts) counts[m.role as keyof typeof counts] += 1;
      if (m.status === "invited") counts.pending += 1;
      if (m.status === "active") {
        counts.active += 1;
        if (!m.isOwner) counts.accepted += 1;
      }
    }
    return json({ schemaVersion: 1, workspaceId: profile.workspace_id, members: list, counts,
      totalMembers: list.length, teammateCount: list.filter((m) => !m.isOwner).length, requestId: crypto.randomUUID() }, 200, origin);
  } catch (error) {
    console.error("get-workspace-team failed", error);
    return json({ error: "Something went wrong while loading workspace members." }, 500, origin);
  }
});
