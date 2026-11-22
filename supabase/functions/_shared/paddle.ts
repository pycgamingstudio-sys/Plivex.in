export const paddleConfig = () => {
  const apiKey = Deno.env.get("PADDLE_API_KEY");
  const environment = Deno.env.get("PADDLE_ENV") === "production" ? "production" : "sandbox";
  if (!apiKey) throw new Error("Paddle credentials are not configured.");
  return {
    apiKey,
    environment,
    apiBase: environment === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com",
    appBase: (Deno.env.get("APP_BASE_URL") || "https://plivex.in").replace(/\/$/, ""),
  };
};

export async function paddleApi(path: string, init: RequestInit = {}) {
  const config = paddleConfig();
  const response = await fetch(config.apiBase + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Paddle API request failed", { status: response.status, error: payload?.error?.code || payload?.error?.type || "provider_error" });
    throw new Error("Paddle could not create the checkout. Please retry later.");
  }
  return payload;
}

export async function verifyPaddleWebhookSignature(rawBody: string, signatureHeader: string, secret: string, nowMs = Date.now()) {
  if (!rawBody || !signatureHeader || !secret) return false;
  const fields = signatureHeader.split(";").map((part) => part.trim().split("=", 2));
  const timestamp = fields.find(([key]) => key === "ts")?.[1] || "";
  const signatures = fields.filter(([key]) => key === "h1").map(([, value]) => value).filter(Boolean);
  if (!/^\d{10}$/.test(timestamp) || !signatures.length) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(timestampMs) || Math.abs(nowMs - timestampMs) > 5000) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}:${rawBody}`));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => {
    if (signature.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
    return difference === 0;
  });
}
