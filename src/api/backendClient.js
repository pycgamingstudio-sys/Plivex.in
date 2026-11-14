// Plivex backend client.
// Replaces the old Base44 SDK. It keeps the same small surface the app already
// uses (db.auth.*, db.functions.invoke, db.entities.*, db.integrations.*) so most
// screens did not need to change.
//
//  - Login / signup / password reset  -> Supabase Auth (your own Supabase project)
//  - Business endpoints                -> POST <API base>/api/public/<kebab-name>
//    with the Supabase access token in the Authorization header.
import { createClient } from '@supabase/supabase-js';
import { resolveEditionId } from '@/global/core/edition-contract.js';

export const APP_EDITION = resolveEditionId(import.meta.env.VITE_APP_EDITION);

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Address where the backend endpoints run (the published Lovable app).
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Shown in the browser console so a missing Netlify variable is easy to spot.
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them in Netlify > Site settings > Environment variables.');
}

export const assistantEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = createClient(SUPABASE_URL || 'http://invalid.local', SUPABASE_ANON_KEY || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export class ApiError extends Error {
  constructor(message, status = 0, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
    this.response = { status, data };
    this.operation = data?.operation;
    this.requestId = data?.requestId;
  }
}

const kebab = (name) => name.replace(/([A-Z])/g, '-$1').toLowerCase();

function emitPlanError(message) {
  if (typeof window !== "undefined" && (String(message || "").startsWith("PLAN_LIMIT_REACHED|") || String(message || "").startsWith("PLAN_FEATURE_LOCKED|"))) {
    window.dispatchEvent(new CustomEvent("plivex-sync-error", { detail: { message: String(message) } }));
  }
}

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function callEndpoint(name, payload = {}) {
  const token = await accessToken();
  let res;
  try {
    res = await fetch(`${API_BASE}/api/public/${kebab(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload || {}),
    });
  } catch {
    throw new ApiError('Network request failed. Please check your connection.', 0, { operation: name });
  }
  let body = {};
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : 'Request failed';
    emitPlanError(message);
    throw new ApiError(message, res.status, body);
  }
  return body;
}

// --- Per-endpoint adapters: keep the response shapes the screens already expect.
const adapters = {
  verifyInviteCode: {
    request: ({ code, allowRebind }) => ({ code, allowRebind }),
  },
  sendTeamInvite: {
    response: (data, payload) => ({
      ...data,
      sentTo: payload?.to,
      warning: data.emailSent ? undefined : 'The invite email could not be sent. Please share this invite code with the member yourself.',
    }),
  },
  getWorkspaceTeam: {
    response: (data) => {
      const members = Array.isArray(data.members) ? data.members : [];
      const roleCount = (role) => members.filter((m) => m.role === role).length;
      const statusCount = (status) => members.filter((m) => m.status === status).length;
      return {
        schemaVersion: 1,
        workspaceId: data.workspaceId,
        members,
        counts: {
          admin: roleCount('admin'), manager: roleCount('manager'), employee: roleCount('employee'),
          storekeeper: roleCount('storekeeper'), accountant: roleCount('accountant'),
          pending: statusCount('invited'), accepted: statusCount('accepted'), active: statusCount('active'),
        },
        totalMembers: members.length,
        teammateCount: members.filter((m) => m.role !== 'admin').length,
        requestId: data.requestId || '',
      };
    },
  },
};

// Global workspace-record adapter. It never calls India workspace-record endpoints.
async function invokeGlobalWorkspaceRecords(payload = {}) {
  const { data: context, error: contextError } = await supabase.functions.invoke("global-auth-context", { body: {} });
  if (contextError) throw new ApiError(contextError.message || "Could not load your Global workspace.", contextError.status || 400, { operation: "global-auth-context" });
  const workspaceId = context?.user?.workspace_id;
  const currencyCode = context?.user?.currency_code || "USD";
  if (!workspaceId) throw new ApiError("Your Global workspace is not ready.", 409, { operation: "workspaceRecords" });

  const sourceTable = String(payload.table || "");
  const table = sourceTable === "business_profile" ? "business_profiles" : sourceTable;
  if (!["business_profiles", "clients", "expenses"].includes(table)) {
    throw new ApiError("This Global record type is not connected yet.", 501, { operation: "workspaceRecords", table: sourceTable });
  }
  const requestedAction = String(payload.action || "list");
  const action = requestedAction === "get" ? "list" : requestedAction === "upsert" ? "update" : requestedAction;
  if (!["list", "create", "update", "delete"].includes(action) || (table === "business_profiles" && !["list", "update"].includes(action))) {
    throw new ApiError("This Global record operation is not available.", 501, { operation: "workspaceRecords", table, action: requestedAction });
  }

  const values = { ...(payload.values || {}) };
  if (table === "business_profiles") {
    const profile = {};
    if (values.name !== undefined) { profile.legal_name = values.name; profile.display_name = values.name; }
    for (const [from, to] of [["email", "email"], ["phone", "phone"], ["address", "address"]]) {
      if (values[from] !== undefined) profile[to] = values[from] || null;
    }
    if (values.gstin) profile.tax_registration_number = values.gstin;
    for (const key of ["tax_registration_number", "tax_registration_type", "tax_registration_status", "tax_registration_effective_from", "tax_jurisdiction_code"]) {
      if (values[key] !== undefined) profile[key] = values[key] || null;
    }
    Object.assign(values, profile);
    for (const key of ["name", "gstin", "logo_url", "upi_id"]) delete values[key];
  } else if (table === "clients") {
    if (values.company !== undefined) values.name = values.name || values.company;
    if (values.gstin !== undefined) values.tax_registration_number = values.gstin;
    if (values.address !== undefined) values.billing_address = { formatted: String(values.address || "") };
    for (const key of ["company", "gstin", "address"]) delete values[key];
  } else if (table === "expenses") {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency: currencyCode }).resolvedOptions().maximumFractionDigits;
    if (values.amount !== undefined) values.amount_minor = Math.round(Number(values.amount) * (10 ** digits));
    if (values.date !== undefined) values.expense_date = values.date || null;
    if (values.method !== undefined) values.payment_method = values.method || null;
    values.currency_code = currencyCode;
    for (const key of ["amount", "date", "method", "status"]) delete values[key];
  }

  const request = { workspace_id: workspaceId, table, action, limit: payload.limit || 100 };
  if (action === "create" || action === "update") request.values = values;
  if (action === "update") request.id = table === "business_profiles" ? workspaceId : payload.id;
  if (action === "delete") request.id = payload.id;
  const { data, error } = await supabase.functions.invoke("global-business-records", { body: request });
  if (error) {
    let message = error.message || "Global records request failed.";
    try {
      const body = await error.context?.clone?.().json();
      if (typeof body?.error === "string") message = body.error;
    } catch { /* keep SDK message */ }
    throw new ApiError(message, error.status || 400, { operation: "workspaceRecords", table });
  }

  const normalize = (record) => {
    if (!record || typeof record !== "object") return record;
    if (table === "business_profiles") return { ...record, name: record.display_name || record.legal_name || "", gstin: record.tax_registration_number || "" };
    if (table === "clients") return { ...record, company: record.name || "", gstin: record.tax_registration_number || "", address: record.billing_address?.formatted || "" };
    if (table === "expenses") {
      const digits = new Intl.NumberFormat("en", { style: "currency", currency: currencyCode }).resolvedOptions().maximumFractionDigits;
      return { ...record, amount: Number(record.amount_minor || 0) / (10 ** digits), date: record.expense_date || "", method: record.payment_method || "" };
    }
    return record;
  };
  const records = Array.isArray(data?.records) ? data.records.map(normalize) : [];
  const record = normalize(data?.record || records[0] || null);
  return { data: { ...data, records, record, items: records } };
}

// Features whose backend is not built yet. They fail with a clear message instead of a crash.
const NOT_READY = {};

const functions = {
  async invoke(name, payload = {}) {
    if (NOT_READY[name]) throw new ApiError(NOT_READY[name], 501, { error: NOT_READY[name], operation: name });
    // Migrated handlers run directly as Supabase Edge Functions. Unmigrated
    // operations intentionally retain the legacy fallback until their contracts
    // and runtime tests are complete.
    const functionName = kebab(String(name || ""));
    if (APP_EDITION === "global" && functionName === "workspace-records") return invokeGlobalWorkspaceRecords(payload);
    if (APP_EDITION === "global" && !["global-ensure-owner", "global-business-records"].includes(functionName)) {
      throw new ApiError("This Global feature is not enabled yet. Your India workspace is kept separate.", 503, { operation: name });
    }
    const migratedFunctions = new Set([
      "add-client", "ensure-owner-role", "send-team-invite", "verify-invite-code",
      "get-workspace-team", "manage-workspace-member", "ping-presence",
      "track-staff-action", "get-team-presence", "get-access-status", "create-payu-order",
      "global-ensure-owner", "global-business-records", "workspace-records", "manage-cashfree-subscription", "list-invoices", "save-invoice", "set-invoice-status", "send-payment-reminder", "set-invoice-reminder", "confirm-payment-reminder", "update-invoice-client-email",
    ]);
    const adapter = adapters[name] || {};
    const requestPayload = adapter.request ? adapter.request(payload) : payload;
    if (migratedFunctions.has(functionName)) {
      const { data, error } = await supabase.functions.invoke(functionName, { body: requestPayload || {} });
      if (error) {
        let message = error.message || "Request failed. Please try again.";
        try {
          const response = error.context;
          if (response && typeof response.clone === "function") {
            const body = await response.clone().json();
            if (typeof body?.error === "string") message = body.error;
          }
        } catch { /* use the SDK error */ }
        emitPlanError(message);
        throw new ApiError(message, error.status || 400, { operation: name });
      }
      return { data: adapter.response ? adapter.response(data, payload) : data };
    }
    const data = await callEndpoint(name, requestPayload);
    return { data: adapter.response ? adapter.response(data, payload) : data };
  },
};

// --- Auth ---------------------------------------------------------------
const authError = (error, fallback) => {
  const msg = String(error?.message || '');
  if (/email not confirmed/i.test(msg)) return new ApiError('Please confirm your email first. Check your inbox for the confirmation link.', 400);
  if (/invalid login/i.test(msg)) return new ApiError('Invalid email or password', 400);
  return new ApiError(msg || fallback, error?.status || 400);
};

const auth = {
  async me() {
    if (APP_EDITION === "global") {
      const { data: globalData, error: globalError } = await supabase.functions.invoke("global-auth-context", { body: {} });
      if (globalError) {
        let message = globalError.message || "Could not load your Global account.";
        try {
          const body = await globalError.context?.clone?.().json();
          if (typeof body?.error === "string") message = body.error;
        } catch { /* retain SDK message */ }
        throw new ApiError(message, globalError.status || 400, { operation: "global-auth-context" });
      }
      if (!globalData?.user?.id) throw new ApiError("Your Global account could not be loaded.", 401);
      return globalData.user;
    }
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    if (!session) throw new ApiError('Not signed in', 401);
    const uid = session.user.id;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    return {
      id: uid,
      email: session.user.email,
      full_name: profile?.full_name || session.user.user_metadata?.full_name || '',
      role: profile?.role,
      workspace_id: profile?.workspace_id || undefined,
      user_ref: profile?.user_ref,
      trial_start_at: profile?.trial_start_at,
      trial_expires_at: profile?.trial_expires_at,
      created_date: profile?.created_at || session.user.created_at,
      profilePicture: profile?.profile_picture || '',
      phone: session.user.user_metadata?.phone || '',
    };
  },
  async loginViaEmailPassword(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw authError(error, 'Invalid email or password');
    return data;
  },
  async register({ email, password, countryCode = "IN", localeCode = "en-IN" }) {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/`, data: APP_EDITION === "global" ? {} : { signup_country_code: countryCode, signup_locale_code: localeCode } },
    });
    if (error) throw authError(error, 'Registration failed');
    // Supabase hides "already registered" by returning a user with no identities.
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new ApiError('This email is already registered. Please log in instead.', 409);
    }
    return data;
  },
  async resendConfirmation(email) {
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}/` } });
    if (error) throw authError(error, 'Failed to resend email');
  },
  async resetPasswordRequest(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) throw authError(error, 'Could not send reset email');
  },
  async updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw authError(error, 'Failed to reset password');
  },
  // Users may only change their own name and picture; role, workspace and trial dates are server-controlled.
  async updateMe(values = {}) {
    const { data } = await supabase.auth.getSession();
    const uid = data?.session?.user?.id;
    if (!uid) throw new ApiError('Not signed in', 401);
    const patch = {};
    if (values.full_name !== undefined) patch.full_name = values.full_name;
    if (values.profilePicture !== undefined) patch.profile_picture = values.profilePicture;
    if (APP_EDITION === "global") {
      const body = {};
      if (values.full_name !== undefined) body.full_name = values.full_name;
      if (values.profilePicture !== undefined) body.avatar_url = values.profilePicture;
      if (values.phone !== undefined) body.phone = values.phone;
      if (Object.keys(body).length === 0) return null;
      const { error } = await supabase.functions.invoke("global-update-profile", { body });
      if (error) throw new ApiError(error.message || "Global profile update failed", error.status || 400);
      return null;
    }
    if (Object.keys(patch).length === 0 && values.phone === undefined) return null;
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('profiles').update(patch).eq('id', uid);
      if (error) throw new ApiError(error.message || 'Update failed', 400);
    }
    if (values.phone !== undefined) {
      const { data: current, error: userError } = await supabase.auth.getUser();
      if (userError || !current?.user) throw new ApiError(userError?.message || 'Could not load account', 400);
      const { error: metadataError } = await supabase.auth.updateUser({
        data: { ...(current.user.user_metadata || {}), phone: values.phone || null },
      });
      if (metadataError) throw authError(metadataError, 'Could not save mobile number');
    }
    return null;
  },
  async logout(redirectUrl) {
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    window.location.href = redirectUrl || `${window.location.origin}/`;
  },
  setToken() { /* Supabase manages its own session */ },
};

// --- Entities that have no backend yet are inert so screens keep working ---
const inertEntity = {
  async filter() { return { items: [] }; },
  async create() { return null; },
  async update() { return null; },
  subscribe() { return () => {}; },
};
const entities = { StaffActivity: inertEntity, WorkspaceMember: inertEntity, Subscription: inertEntity };

// --- Image upload: stored inline (small, resized) until a file backend is added ---
const resizeToDataUrl = (file, maxSize = 512) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Could not read the file'));
  reader.onload = () => {
    const img = new window.Image();
    img.onerror = () => reject(new Error('Not a valid image'));
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Image processing is not supported in this browser'));
        return;
      }
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch {
        reject(new Error('Could not process the image'));
      }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});
const integrations = { Core: { async UploadFile({ file }) { return { file_url: await resizeToDataUrl(file) }; } } };

export const backend = { auth, functions, entities, integrations };
export const db = backend;
export default backend;
