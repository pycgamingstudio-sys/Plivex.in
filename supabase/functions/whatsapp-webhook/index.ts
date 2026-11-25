import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(rawBody: string, signature: string, appSecret: string) {
  if (!signature.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(signature.slice(7).toLowerCase(), hex);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode") ?? url.searchParams.get("hub[mode]");
    const token = url.searchParams.get("hub.verify_token") ?? url.searchParams.get("hub[verify_token]");
    const challenge = url.searchParams.get("hub.challenge") ?? url.searchParams.get("hub[challenge]");
    const expectedToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

    if (!expectedToken) return json({ error: "WHATSAPP_VERIFY_TOKEN is not configured" }, 503);
    if (mode === "subscribe" && token && challenge && safeEqual(token, expectedToken)) {
      return new Response(challenge, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return json({ error: "Webhook verification failed" }, 403);
  }

  if (req.method === "POST") {
    const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
    if (!appSecret) return json({ error: "WHATSAPP_APP_SECRET is not configured" }, 503);

    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256") ?? "";
    const valid = await verifySignature(rawBody, signature, appSecret);
    if (!valid) return json({ error: "Invalid webhook signature" }, 401);

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "Invalid JSON payload" }, 400);
    }

    // Signature-verified receipt only. Message persistence/routing is added
    // after the workspace-scoped WhatsApp data model is implemented.
    return json({ received: true, object: (payload as { object?: string })?.object ?? null }, 200);
  }

  return json({ error: "Method not allowed" }, 405);
});