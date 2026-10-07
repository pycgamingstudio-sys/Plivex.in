// Plivex backend client.
// Replaces the old Base44 SDK. It keeps the same small surface the app already
// uses (db.auth.*, db.functions.invoke, db.entities.*, db.integrations.*) so most
// screens did not need to change.
//
//  - Login / signup / password reset  -> Supabase Auth (your own Supabase project)
//  - Business endpoints                -> POST <API base>/api/public/<kebab-name>
//    with the Supabase access token in the Authorization header.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Address where the backend endpoints run (the published Lovable app).
const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://member-sync-flow.lovable.app').replace(/\/+$/, '');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Shown in the browser console so a missing Netlify variable is easy to spot.
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them in Netlify > Site settings > Environment variables.');
}

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
  if (!res.ok) throw new ApiError(typeof body?.error === 'string' ? body.error : 'Request failed', res.status, body);
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
      warning: data.emailSent ? undefined : 'Invite email is not enabled yet. Please share this invite code with the member yourself.',
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

// Features whose backend is not built yet. They fail with a clear message instead of a crash.
const NOT_READY = {
  sendPaymentReminder: 'Payment reminder emails are not available yet.',
};

const functions = {
  async invoke(name, payload = {}) {
    if (NOT_READY[name]) throw new ApiError(NOT_READY[name], 501, { error: NOT_READY[name], operation: name });
    const adapter = adapters[name] || {};
    const data = await callEndpoint(name, adapter.request ? adapter.request(payload) : payload);
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
    };
  },
  async loginViaEmailPassword(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw authError(error, 'Invalid email or password');
    return data;
  },
  async register({ email, password }) {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/` },
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
    if (Object.keys(patch).length === 0) return null;
    const { error } = await supabase.from('profiles').update(patch).eq('id', uid);
    if (error) throw new ApiError(error.message || 'Update failed', 400);
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
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});
const integrations = { Core: { async UploadFile({ file }) { return { file_url: await resizeToDataUrl(file) }; } } };

export const backend = { auth, functions, entities, integrations };
export const db = backend;
export default backend;
