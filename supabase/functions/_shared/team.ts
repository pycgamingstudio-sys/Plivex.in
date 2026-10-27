import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
export const isAllowedOrigin = (o: string | null) => !o || ORIGINS.has(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.workers\.dev$/.test(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.pages\.dev$/.test(o);
export const corsHeaders = (o: string | null) => ({ "Access-Control-Allow-Origin": o && isAllowedOrigin(o) ? o : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
export const jsonResponse = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });

export async function authenticate(req: Request): Promise<{ user: any; admin: any } | { error: string; status: number }> {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return { error: "Please sign in.", status: 401 as const };
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return { error: "Workspace service is not configured.", status: 503 as const };
  const authClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error || !user) return { error: "Your session expired. Please sign in again.", status: 401 as const };
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  return { user, admin };
}

export async function getAdminScope(admin: any, userId: string) {
  const { data: profile } = await admin.from("profiles").select("role,workspace_id").eq("id", userId).maybeSingle();
  if (!profile || profile.role !== "admin" || !profile.workspace_id) return null;
  const { data: ownerRow } = await admin.from("workspace_members").select("id,owner_id").eq("workspace_id", profile.workspace_id).eq("role", "admin").not("owner_id", "is", null).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!ownerRow?.owner_id) return null;
  return { workspaceId: profile.workspace_id as string, ownerId: ownerRow.owner_id as string, ownerRowId: ownerRow.id as string };
}
