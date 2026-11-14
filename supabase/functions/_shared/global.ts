import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = new Set([
  "https://global.plivex.in",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const allowedOrigin = (origin: string | null) => !origin || ALLOWED_ORIGINS.has(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:workers|pages)\.dev$/.test(origin);
export const globalCorsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigin(origin) ? origin : "https://global.plivex.in",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
export const globalJson = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...globalCorsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
export const isGlobalOriginAllowed = allowedOrigin;

export async function authenticateGlobal(req: Request): Promise<
  { user: any; admin: any } | { error: string; status: number }
> {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return { error: "Please sign in.", status: 401 };
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return { error: "Global account service is not configured.", status: 503 };

  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error || !user) return { error: "Your session expired. Please sign in again.", status: 401 };

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  return { user, admin };
}
