export const INTEGRATION_STATUSES = Object.freeze([
  "available",
  "setup_required",
  "awaiting_provider_access",
  "sandbox_tested",
  "live_verified",
]);

export const INTEGRATION_CATALOG = Object.freeze([
  Object.freeze({ key: "shopify", label: "Shopify", category: "commerce", requiresOwnerSetup: true }),
  Object.freeze({ key: "whatsapp_cloud", label: "WhatsApp Cloud", category: "messaging", requiresOwnerSetup: true }),
  Object.freeze({ key: "cashfree", label: "Cashfree", category: "payments", requiresOwnerSetup: true }),
  Object.freeze({ key: "paddle", label: "Paddle", category: "subscriptions", requiresOwnerSetup: true }),
  Object.freeze({ key: "public_api", label: "Plivex Public API", category: "developer", requiresOwnerSetup: false }),
  Object.freeze({ key: "custom_webhooks", label: "Custom webhooks", category: "developer", requiresOwnerSetup: true }),
]);

export const WORKSPACE_EVENT_TYPES = Object.freeze([
  "invoice.created",
  "invoice.status_changed",
  "lead.created",
  "lead.stage_changed",
  "expense.created",
  "stock.low_stock",
]);

const catalogByKey = new Map(INTEGRATION_CATALOG.map((item) => [item.key, item]));

export function getIntegrationDefinition(providerKey) {
  return typeof providerKey === "string" ? catalogByKey.get(providerKey) ?? null : null;
}

export function normalizeIntegrationStatus(status) {
  return INTEGRATION_STATUSES.includes(status) ? status : "setup_required";
}

export function getIntegrationStatusLabel(status) {
  const labels = {
    available: "Available",
    setup_required: "Setup required",
    awaiting_provider_access: "Awaiting provider access",
    sandbox_tested: "Sandbox tested",
    live_verified: "Live verified",
  };
  return labels[normalizeIntegrationStatus(status)];
}

export function isLiveVerified(record) {
  return Boolean(
    record
    && record.status === "live_verified"
    && typeof record.verified_at === "string"
    && Number.isFinite(Date.parse(record.verified_at))
    && Date.parse(record.verified_at) <= Date.now(),
  );
}

export function validateWebhookEventTypes(eventTypes) {
  return Array.isArray(eventTypes)
    && eventTypes.length >= 1
    && eventTypes.length <= 8
    && new Set(eventTypes).size === eventTypes.length
    && eventTypes.every((eventType) => WORKSPACE_EVENT_TYPES.includes(eventType));
}

export function validateWebhookEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return { ok: false, code: "INVALID_URL" };
  let url;
  try { url = new URL(value); } catch { return { ok: false, code: "INVALID_URL" }; }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    return { ok: false, code: "HTTPS_REQUIRED" };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host === "0.0.0.0"
    || host === "127.0.0.1"
    || host === "::1"
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^169\.254\./.test(host)
  ) return { ok: false, code: "PRIVATE_HOST_NOT_ALLOWED" };
  return { ok: true, url: url.toString() };
}

export function getWebhookRetryDelaySeconds(attemptCount) {
  if (!Number.isInteger(attemptCount) || attemptCount < 0) return null;
  if (attemptCount >= 12) return null;
  return Math.min(6 * 60 * 60, 30 * (2 ** Math.min(attemptCount, 10)));
}
