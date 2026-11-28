export type PublicApiCursor = { created_at: string; id: string };
export type PublicApiLeadInput = {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  requirement: string | null;
  value: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function encodePublicApiCursor(record: PublicApiCursor): string {
  if (!UUID.test(record.id) || !Number.isFinite(Date.parse(record.created_at))) {
    throw new Error("API_CURSOR_INVALID");
  }
  const bytes = new TextEncoder().encode(JSON.stringify({
    created_at: new Date(record.created_at).toISOString(),
    id: record.id.toLowerCase(),
  }));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodePublicApiCursor(value: unknown): PublicApiCursor | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded));
    if (!decoded || typeof decoded !== "object" || !UUID.test(String(decoded.id || ""))) return null;
    if (typeof decoded.created_at !== "string" || !Number.isFinite(Date.parse(decoded.created_at))) return null;
    const date = new Date(decoded.created_at);
    if (date.toISOString() !== decoded.created_at) return null;
    return { created_at: date.toISOString(), id: String(decoded.id).toLowerCase() };
  } catch {
    return null;
  }
}

export function parsePublicApiLimit(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return null;
  return parsed;
}

export function normalizePublicApiLead(input: unknown): { ok: true; value: PublicApiLeadInput } | { ok: false; code: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, code: "INVALID_LEAD" };
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const company = typeof raw.company === "string" ? raw.company.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const phone = typeof raw.phone === "string" ? raw.phone.trim() : "";
  const requirement = typeof raw.requirement === "string" ? raw.requirement.trim() : "";
  const value = raw.value === undefined || raw.value === null || raw.value === "" ? 0 : Number(raw.value);
  if (name.length < 2 || name.length > 160) return { ok: false, code: "INVALID_NAME" };
  if (company.length > 160) return { ok: false, code: "INVALID_COMPANY" };
  if (email.length > 254 || (email && !EMAIL.test(email))) return { ok: false, code: "INVALID_EMAIL" };
  if (phone.length > 32) return { ok: false, code: "INVALID_PHONE" };
  if (requirement.length > 2000) return { ok: false, code: "INVALID_REQUIREMENT" };
  if (!Number.isFinite(value) || value < 0 || value > 999999999999) return { ok: false, code: "INVALID_VALUE" };
  return {
    ok: true,
    value: {
      name,
      company: company || null,
      email: email || null,
      phone: phone || null,
      requirement: requirement || null,
      value,
    },
  };
}

export function publicApiError(code: string, requestId: string) {
  const definitions: Record<string, { status: number; message: string; retryable: boolean }> = {
    API_KEY_REQUIRED: { status: 401, message: "An API key is required.", retryable: false },
    API_KEY_INVALID: { status: 401, message: "The API key is invalid, expired or revoked.", retryable: false },
    API_KEY_OR_SCOPE_INVALID: { status: 401, message: "The API key is invalid or lacks the required write scope.", retryable: false },
    API_SCOPE_DENIED: { status: 403, message: "The API key does not have the required scope.", retryable: false },
    API_RATE_LIMITED: { status: 429, message: "The API rate limit has been reached.", retryable: true },
    API_VERSION_UNSUPPORTED: { status: 400, message: "The requested API version is not supported.", retryable: false },
    API_CURSOR_INVALID: { status: 400, message: "The pagination cursor is invalid.", retryable: false },
    API_LIMIT_INVALID: { status: 400, message: "The page limit must be an integer from 1 to 100.", retryable: false },
    API_IDEMPOTENCY_KEY_INVALID: { status: 400, message: "The Idempotency-Key header has an invalid format.", retryable: false },
    INVALID_NAME: { status: 400, message: "The lead name must contain 2 to 160 characters.", retryable: false },
    INVALID_EMAIL: { status: 400, message: "The email address is invalid.", retryable: false },
    INVALID_PHONE: { status: 400, message: "The phone value is too long.", retryable: false },
    INVALID_COMPANY: { status: 400, message: "The company value is too long.", retryable: false },
    INVALID_REQUIREMENT: { status: 400, message: "The requirement value is too long.", retryable: false },
    INVALID_VALUE: { status: 400, message: "The lead value must be a valid non-negative amount.", retryable: false },
    API_IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: "An Idempotency-Key header is required for this write.", retryable: false },
    IDEMPOTENCY_KEY_REUSED: { status: 409, message: "This idempotency key was already used with a different request.", retryable: false },
    IDEMPOTENCY_IN_PROGRESS: { status: 409, message: "A request with this idempotency key is still processing.", retryable: true },
    API_READ_FAILED: { status: 503, message: "The requested resource is temporarily unavailable.", retryable: true },
    API_WRITE_FAILED: { status: 503, message: "The write could not be completed.", retryable: true },
  };
  const definition = definitions[code] || { status: 400, message: "The API request could not be completed.", retryable: false };
  return {
    status: definition.status,
    body: {
      api_version: "v1",
      error: { code, message: definition.message, retryable: definition.retryable, request_id: requestId },
    },
  };
}
