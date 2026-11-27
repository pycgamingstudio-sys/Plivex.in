import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const routes = {
  "/v1/workspace": { scope: "workspace.read", table: "workspace_settings", columns: "workspace_id,country_code,locale_code,currency_code,workspace_type", order: "updated_at" },
  "/v1/clients": { scope: "clients.read", table: "clients", columns: "id,name,company,email,phone,gstin,address,created_at", order: "created_at" },
  "/v1/invoices": { scope: "invoices.read", table: "invoices", columns: "id,number,client_name,issue_date,due_date,currency,status,is_draft,subtotal,tax_value,total,created_at", order: "created_at" },
  "/v1/expenses": { scope: "expenses.read", table: "expenses", columns: "id,vendor,category,amount,date,status,method,notes,currency_code,created_at", order: "created_at" },
  "/v1/leads": { scope: "leads.read", table: "leads", columns: "id,name,company,email,phone,requirement,value,stage,source,score,next_follow_up_at,created_at", order: "created_at" },
} as const;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("dynamic-api missing Supabase server configuration");
    return json({ error: "service_unavailable" }, 503);
  }

  const url = new URL(req.url);
  const route = routes[url.pathname as keyof typeof routes];
  if (!route) return json({ error: "not_found", supported: Object.keys(routes) }, 404);

  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(plx_[A-Za-z0-9]{24,})$/i)?.[1];
  const rawKey = bearer ?? req.headers.get("x-api-key") ?? "";
  if (!/^plx_[A-Za-z0-9]{24,}$/.test(rawKey)) return json({ error: "unauthorized" }, 401);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const keyHash = await sha256(rawKey);
  const { data: keyRecord, error: keyError } = await db
    .from("public_api_keys")
    .select("id,workspace_id,scopes")
    .eq("key_hash", keyHash)
    .eq("key_prefix", rawKey.slice(0, 10))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (keyError) {
    console.error("dynamic-api key lookup failed", keyError.message);
    return json({ error: "service_unavailable" }, 503);
  }
  if (!keyRecord) return json({ error: "unauthorized" }, 401);
  if (!Array.isArray(keyRecord.scopes) || !keyRecord.scopes.includes(route.scope)) {
    return json({ error: "insufficient_scope", required_scope: route.scope }, 403);
  }

  const { data: withinLimit, error: rateError } = await db.rpc(
    "consume_main_workspace_api_rate_limit",
    { p_key_hash: keyHash, p_limit: 60, p_window_seconds: 60 },
  );
  if (rateError) {
    console.error("dynamic-api rate limiter failed", rateError.message);
    return json({ error: "service_unavailable" }, 503);
  }
  if (withinLimit !== true) return json({ error: "rate_limit_exceeded" }, 429);

  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return json({ error: "invalid_limit", allowed: "1..100" }, 400);
  }

  let query = db.from(route.table).select(route.columns).eq("workspace_id", keyRecord.workspace_id);
  query = query.order(route.order, { ascending: false }).limit(limit);
  const { data, error } = await query;
  if (error) {
    console.error("dynamic-api read failed", { table: route.table, message: error.message });
    return json({ error: "data_unavailable" }, 503);
  }

  const { error: touchError } = await db.from("public_api_keys")
    .update({ last_used_at: new Date().toISOString() }).eq("id", keyRecord.id);
  if (touchError) console.warn("dynamic-api last-used update failed", touchError.message);

  return json({
    data: data ?? [],
    meta: { resource: route.table, count: data?.length ?? 0, limit, workspace_id: keyRecord.workspace_id },
  });
});
