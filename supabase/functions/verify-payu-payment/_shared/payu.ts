export const PLANS = {
  basic_monthly: { id: "basic_monthly", name: "Basic Monthly", tier: "basic", amountPaise: 19900, period: "month" },
  pro_monthly: { id: "pro_monthly", name: "Pro Monthly", tier: "pro", amountPaise: 24900, period: "month" },
  basic_yearly: { id: "basic_yearly", name: "Basic Yearly", tier: "basic", amountPaise: 99900, period: "year" },
  enterprise_yearly: { id: "enterprise_yearly", name: "Enterprise Yearly", tier: "pro", amountPaise: 159900, period: "year" },
} as const;
export type PlanId = keyof typeof PLANS;
export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && Object.prototype.hasOwnProperty.call(PLANS, v);
export const addPeriod = (from: Date, period: "month" | "year") => {
  const d = new Date(from), day = d.getUTCDate();
  if (period === "month") d.setUTCMonth(d.getUTCMonth() + 1); else d.setUTCFullYear(d.getUTCFullYear() + 1);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d;
};
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export const sha512 = async (s: string) => hex(await crypto.subtle.digest("SHA-512", new TextEncoder().encode(s)));
export const safeEqualHex = (a: string, b: string) => {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (!x || x.length !== y.length) return false;
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
};
type HashFields = { key: string; txnid: string; amount: string; productinfo: string; firstname: string; email: string; udf?: string[] };
export const requestHash = async (f: HashFields, salt: string) => {
  const u = [0,1,2,3,4].map((i) => f.udf?.[i] ?? "");
  return sha512([f.key,f.txnid,f.amount,f.productinfo,f.firstname,f.email,...u,"","","","","",salt].join("|"));
};
export const reverseHash = async (f: HashFields & { status: string; additionalCharges?: string }, salt: string) => {
  const u = [4,3,2,1,0].map((i) => f.udf?.[i] ?? "");
  const base = [salt,f.status,"","","","","",...u,f.email,f.firstname,f.productinfo,f.amount,f.txnid,f.key].join("|");
  return sha512(f.additionalCharges ? `${f.additionalCharges}|${base}` : base);
};
export const safePath = (p: unknown) => typeof p === "string" && p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") && p.length <= 200 ? p.split("?")[0]?.split("#")[0] || "/" : "/";
export const allowedOrigin = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;
  try {
    const u = new URL(value), allowed = new Set(["https://plivex.in","https://www.plivex.in","https://plivex.netlify.app",fallback]);
    return u.origin === value.replace(/\/$/, "") && u.protocol === "https:" && allowed.has(u.origin) ? u.origin : fallback;
  } catch { return fallback; }
};
export const randomTxn = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "PLX" + Date.now().toString(36).toUpperCase() + Array.from(crypto.getRandomValues(new Uint8Array(14)), (x) => chars[x % chars.length]).join("");
};
export const config = () => {
  const key = Deno.env.get("PAYU_MERCHANT_KEY"), salt = Deno.env.get("PAYU_MERCHANT_SALT");
  const environment = Deno.env.get("PAYU_ENV") === "production" ? "production" : "test";
  const appBase = (Deno.env.get("APP_BASE_URL") || "https://plivex.in").replace(/\/$/, "");
  if (!key || !salt) throw new Error("PayU secrets are not configured");
  return { key, salt, environment, appBase, action: environment === "production" ? "https://secure.payu.in/_payment" : "https://test.payu.in/_payment" };
};
