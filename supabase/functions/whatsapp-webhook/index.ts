import { createGlobalAdminClient } from "../_shared/global.ts";

const encoder = new TextEncoder();
function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i++) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}
async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return "sha256=" + [...digest].map((v) => v.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
    if (mode === "subscribe" && expected && safeEqual(token, expected)) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("WHATSAPP_APP_SECRET") || "";
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const raw = await req.text();
  if (raw.length > 1024 * 1024) return new Response("Payload too large", { status: 413 });
  const supplied = req.headers.get("x-hub-signature-256") || "";
  const expected = await signature(secret, raw);
  if (!safeEqual(supplied, expected)) return new Response("Invalid signature", { status: 401 });
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const admin = createGlobalAdminClient();
  const statusRank: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  let updated = 0;
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const item of change?.value?.statuses || []) {
        const messageId = String(item?.id || "");
        const status = String(item?.status || "");
        if (!messageId || !["sent", "delivered", "read", "failed"].includes(status)) continue;
        const { data: current } = await admin.schema("global").from("whatsapp_delivery_logs")
          .select("id,status").eq("provider_message_id", messageId).maybeSingle();
        if (!current) continue;
        if (status !== "failed" && (statusRank[status] ?? 0) < (statusRank[current.status] ?? 0)) continue;
        const errorCode = status === "failed" ? String(item?.errors?.[0]?.code || "META_DELIVERY_FAILED").slice(0, 80) : null;
        const { error } = await admin.schema("global").from("whatsapp_delivery_logs")
          .update({ status, error_code: errorCode }).eq("id", current.id);
        if (!error) updated++;
      }
    }
  }
  return new Response(JSON.stringify({ ok: true, updated }), { status: 200, headers: { "Content-Type": "application/json" } });
});
