import { getTenantId, tenantKey } from "@/lib/stores";

// Workspace/session-scoped cache that must never leak across accounts.
// Flushed on logout and on a fresh signup so a new user never inherits the
// previous account's trial clock, subscription, usage counters or SMTP settings.

// Global keys owned by the paywall (paywall.jsx reads these directly, not via
// the tenant store, so they are cleared globally on logout).
const GLOBAL_SESSION_KEYS = [
  "invoicepulse:actionCount",
  "invoicepulse:isPremium",
  "invoicepulse:subscription",
  "invoicepulse:planName",
  "invoicepulse:trialStart",
];

// Tenant-scoped state bases cleared for the current user on logout.
const TENANT_STATE_BASES = [
  "cardVisibility",
  "teamInvites",
  "emailSettings",
  "is_premium_user",
  "invoicepulse_usage_count",
];

export function clearSessionCache() {
  try {
    GLOBAL_SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
    const tenant = getTenantId();
    TENANT_STATE_BASES.forEach((base) => localStorage.removeItem(tenantKey(base)));
    sessionStorage.clear();
  } catch { /* best effort */ }
}