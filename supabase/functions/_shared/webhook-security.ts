export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

async function hmacBytes(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return [...await hmacBytes(secret, message)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const bytes = await hmacBytes(secret, message);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function isFreshWebhookTimestamp(value: string, nowMs = Date.now(), toleranceSeconds = 300): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && Math.abs(Math.floor(nowMs / 1000) - timestamp) <= toleranceSeconds;
}

export async function verifyCustomWebhookSignature(
  secret: string,
  timestamp: string,
  eventId: string,
  signature: string,
  rawBody: string,
  nowMs = Date.now(),
): Promise<{ ok: boolean; code?: string }> {
  if (!isFreshWebhookTimestamp(timestamp, nowMs)) return { ok: false, code: "WEBHOOK_TIMESTAMP_EXPIRED" };
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(eventId)) return { ok: false, code: "WEBHOOK_EVENT_ID_INVALID" };
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return { ok: false, code: "WEBHOOK_SIGNATURE_INVALID" };
  const expected = await hmacSha256Hex(secret, timestamp + "." + eventId + "." + rawBody);
  return safeEqual(signature.slice(7).toLowerCase(), expected)
    ? { ok: true }
    : { ok: false, code: "WEBHOOK_SIGNATURE_INVALID" };
}

export async function verifyShopifyWebhookSignature(
  secret: string,
  signature: string,
  rawBody: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = await hmacSha256Base64(secret, rawBody);
  return safeEqual(signature, expected);
}

export function isAllowedWebhookEvent(provider: string, eventType: string, allowedEvents: unknown): boolean {
  if (!Array.isArray(allowedEvents) || !allowedEvents.every((item) => typeof item === "string")) return false;
  const providerAllowed = provider === "shopify"
    ? ["orders/create", "orders/updated", "products/create", "products/update", "inventory_levels/update"]
    : provider === "custom"
      ? ["invoice.created", "invoice.status_changed", "lead.created", "lead.stage_changed", "expense.created", "stock.low_stock"]
      : [];
  return providerAllowed.includes(eventType) && allowedEvents.includes(eventType);
}
