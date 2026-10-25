import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = new Set([
  "https://plivex.in",
  "https://www.plivex.in",
  "https://plivex.netlify.app",
]);
const isAllowedOrigin = (origin: string | null) => !origin || ALLOWED_ORIGINS.has(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.workers\.dev$/.test(origin)
  || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.pages\.dev$/.test(origin);

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && isAllowedOrigin(origin) ? origin : "https://plivex.in";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const allowedCategories = ["Rent", "Raw Materials", "Utilities", "Salary", "Logistics", "Software", "Marketing", "Other"];

function validateAction(action: unknown) {
  if (!action || typeof action !== "object") return null;
  const candidate = action as Record<string, unknown>;
  const type = text(candidate.type, 40);
  const raw = candidate.payload && typeof candidate.payload === "object"
    ? candidate.payload as Record<string, unknown>
    : {};

  if (type === "create_client") {
    const name = text(raw.name, 120);
    if (!name) return null;
    return { type, payload: { name, company: text(raw.company, 120), email: text(raw.email, 180), phone: text(raw.phone, 40), gstin: text(raw.gstin, 30), address: text(raw.address, 400) } };
  }
  if (type === "create_expense") {
    const amount = number(raw.amount, -1);
    if (amount <= 0) return null;
    const category = allowedCategories.includes(text(raw.category, 40)) ? text(raw.category, 40) : "Other";
    const date = text(raw.date, 10);
    return { type, payload: { vendor: text(raw.vendor, 120), category, amount, ...( /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}), status: text(raw.status, 40), method: text(raw.method, 40), notes: text(raw.notes, 500) } };
  }
  if (type === "create_lead") {
    const name = text(raw.name, 120);
    if (!name) return null;
    return { type, payload: { name, phone: text(raw.phone, 40), requirement: text(raw.requirement, 500), value: Math.max(0, number(raw.value, 0)), stage: text(raw.stage, 60) || "New" } };
  }
  if (type === "create_stock") {
    const name = text(raw.name, 120);
    const quantity = number(raw.quantity, -1);
    const price = number(raw.price, -1);
    if (!name || quantity < 0 || price < 0) return null;
    return { type, payload: { name, sku: text(raw.sku, 80), quantity, unit: text(raw.unit, 30) || "pcs", price, low_stock: Math.max(0, number(raw.low_stock, 5)) } };
  }
  if (type === "create_quotation") {
    const client_name = text(raw.client_name, 120);
    const total = number(raw.total, -1);
    if (!client_name || total < 0) return null;
    const items = Array.isArray(raw.items) ? raw.items.slice(0, 30).map((entry) => {
      const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      return { description: text(item.description, 160), quantity: Math.max(0, number(item.quantity, 0)), rate: Math.max(0, number(item.rate, 0)), gst_rate: Math.max(0, number(item.gst_rate, 0)) };
    }) : [];
    const date = text(raw.date, 10);
    return { type, payload: { client_name, total, ...( /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}), status: raw.status === "sent" ? "sent" : "draft", tax_rate: Math.max(0, number(raw.tax_rate, 0)), items } };
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { "Vary": "Origin", "Content-Type": "application/json" },
    });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in to confirm this action." }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "Assistant confirmation is not configured." }, 503, origin);

  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);

    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("workspace_id,role").eq("id", user.id).maybeSingle();
    if (profileError || !profile?.workspace_id) return json({ error: "Your Plivex workspace could not be found." }, 403, origin);

    const body = await req.json().catch(() => null);
    const action = validateAction(body?.action);
    if (!action) return json({ error: "The proposed record is incomplete or invalid. Please try again with the required details." }, 400, origin);

    const tableByType: Record<string, string> = {
      create_client: "clients",
      create_expense: "expenses",
      create_lead: "leads",
      create_stock: "stock",
      create_quotation: "quotations",
    };
    const table = tableByType[action.type];
    const { data, error } = await supabase
      .from(table)
      .insert({ workspace_id: profile.workspace_id, ...action.payload })
      .select("id")
      .single();

    if (error) {
      console.error("Assistant confirmation rejected", { table, code: error.code, userId: user.id });
      return json({ error: error.code === "42501" ? "Your Plivex role does not have permission to add this record." : "Could not add the record. Check required fields and workspace permissions." }, error.code === "42501" ? 403 : 400, origin);
    }

    return json({ ok: true, reply: "The record was saved to your Plivex workspace.", created: { type: action.type, id: data.id } }, 200, origin);
  } catch (error) {
    console.error("Assistant confirmation failed", error);
    return json({ error: "Something went wrong while confirming the action." }, 500, origin);
  }
});
