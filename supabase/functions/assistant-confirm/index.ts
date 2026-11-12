import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = new Set([
  "https://plivex.in",
  "https://www.plivex.in",
  "https://plivex.netlify.app",
]);

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://plivex.in";
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
const number = (value: unknown, fallback = NaN) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const allowedCategories = ["Rent", "Raw Materials", "Utilities", "Salary", "Logistics", "Software", "Marketing", "Other"];

function validateAction(action: unknown) {
  if (!action || typeof action !== "object") return null;
  const candidate = action as Record<string, unknown>;
  const type = text(candidate.type, 40);
  const raw = candidate.payload && typeof candidate.payload === "object" ? candidate.payload as Record<string, unknown> : {};
  if (type === "create_invoice") {
    const client_name = text(raw.client_name,120);
    const items = Array.isArray(raw.items) ? raw.items.slice(0,100).map((entry: any) => ({
      description: text(entry?.description,500),
      quantity: number(entry?.quantity,-1),
      rate: number(entry?.rate,-1),
      gst_rate: number(entry?.gst_rate,0),
    })) : [];
    if (!client_name || !items.length || items.some((item: any) => !item.description || !(item.quantity > 0) || !(item.rate >= 0) || item.gst_rate < 0 || item.gst_rate > 100)) return null;
    const tax_mode = raw.tax_mode === "igst" ? "igst" : "split";
    const discount_type = raw.discount_type === "flat" ? "flat" : "percent";
    const discount = number(raw.discount,0), tax_rate = number(raw.tax_rate,0);
    if (tax_rate < 0 || tax_rate > 100 || discount < 0 || (discount_type === "percent" && discount > 100)) return null;
    return { type, payload: {
      client_name, client_email: text(raw.client_email,180), business_name: text(raw.business_name,160),
      issue_date: text(raw.issue_date,10), due_date: text(raw.due_date,10),
      currency: "INR", tax_mode, tax_rate, discount_type, discount,
      notes: text(raw.notes,1000), terms: text(raw.terms,1000), status: "Pending", is_draft: true, items,
    } };
  }
  if (type === "create_expense") {
    const amount = number(raw.amount);
    if (!(amount > 0)) return null;
    return { type, payload: { vendor: text(raw.vendor,120), category: allowedCategories.includes(text(raw.category,40)) ? text(raw.category,40) : "Other", amount, date: text(raw.date,10), status: text(raw.status,40), method: text(raw.method,40), notes: text(raw.notes,500) } };
  }
  if (type === "create_stock") {
    const quantity = number(raw.quantity), price = number(raw.price);
    const name = text(raw.name,120);
    if (!name || !(quantity > 0) || !(price >= 0)) return null;
    return { type, payload: { name, sku: text(raw.sku,80), quantity, unit: text(raw.unit,30) || "pcs", price, low_stock: Math.max(0,number(raw.low_stock,5)) } };
  }
  if (type === "create_client") {
    const name=text(raw.name,120); if(!name) return null;
    return {type,payload:{name,company:text(raw.company,120),email:text(raw.email,180),phone:text(raw.phone,40),gstin:text(raw.gstin,30),address:text(raw.address,400)}};
  }
  if (type === "create_lead") {
    const name=text(raw.name,120); if(!name) return null;
    return {type,payload:{name,phone:text(raw.phone,40),requirement:text(raw.requirement,500),value:Math.max(0,number(raw.value,0)),stage:text(raw.stage,60)||"New"}};
  }
  if (type === "create_quotation") {
    const client_name=text(raw.client_name,120), total=number(raw.total);
    if(!client_name || !(total>=0)) return null;
    return {type,payload:{client_name,total,date:text(raw.date,10),status:raw.status==="sent"?"sent":"draft",tax_rate:Math.max(0,number(raw.tax_rate,0)),items:Array.isArray(raw.items)?raw.items.slice(0,30):[]}};
  }
  return null;
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
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
    const rawActions = Array.isArray(body?.actions) ? body.actions : [body?.action];
    if (!rawActions.length || rawActions.length > 10) return json({ error: "Please confirm between 1 and 10 valid actions." }, 400, origin);
    const actions = rawActions.map(validateAction);
    if (actions.some((action: unknown) => !action)) return json({ error: "Some action details are missing or invalid. Nothing was saved." }, 400, origin);
    const idempotencyKey = text(body?.idempotencyKey,160);
    if (idempotencyKey.length < 16) return json({ error: "Confirmation key is missing. Please refresh the pending action and try again." }, 400, origin);
    const canonical = JSON.stringify(actions);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const requestHash = [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,"0")).join("");
    const { data, error } = await supabase.rpc("execute_assistant_action_batch", {
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
      p_actions: actions,
    });
    if (error) {
      console.error("Assistant batch confirmation rejected", { code: error.code, message: error.message, userId: user.id });
      const message = String(error.message || "");
      if (message.includes("PERMISSION_DENIED")) return json({ error: "Your Plivex role does not have permission for one or more requested actions. Nothing was saved." }, 403, origin);
      if (message.startsWith("PLAN_LIMIT_REACHED|") || message.startsWith("PLAN_FEATURE_LOCKED|")) return json({ error: message }, 409, origin);
      if (message.includes("AUTH_REQUIRED") || message.includes("WORKSPACE_NOT_FOUND")) return json({ error: "Your workspace session could not be verified." }, 403, origin);
      return json({ error: "The action batch could not be completed. No partial records were saved." }, 400, origin);
    }
    return json({ ok: true, reply: actions.length === 1 ? "The record was saved to your Plivex workspace." : "All requested records were saved together to your Plivex workspace.", created: data?.created || [], duplicate: Boolean(data?.duplicate), batchId: data?.batch_id }, 200, origin);
  } catch (error) {
    console.error("Assistant confirmation failed", error);
    return json({ error: "Something went wrong while confirming the action." }, 500, origin);
  }
});
