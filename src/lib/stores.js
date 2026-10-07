import { useState, useEffect } from "react";
import { backend as api } from "@/api/backendClient";

// ──────────────────────────────────────────────────────────────────────────
// Multi-tenant storage layer.
// Business records (invoices, clients, quotations, expenses, leads, stock, services
// and the business profile) now live on the server. They are loaded once after
// sign-in into an in-memory cache (hydrateWorkspaceData) so every screen can keep
// reading them synchronously, and every change is written through to the backend.
// Everything else (templates, activity feed, drafts, settings) stays in the browser.
// Every record is namespaced under invoicepulse:u:<tenantId>:<base> so that
// invoices, clients, expenses and workspace state can NEVER leak, merge or be
// cross-visible between different authenticated users on the same device.
// The tenant id is the logged-in user's id (set by AuthContext after auth).
// ──────────────────────────────────────────────────────────────────────────

// Base storage keys (the tenant namespace is applied transparently below).
export const KEYS = {
  history: "history",
  businessProfile: "businessProfile",
  clients: "clients",
  templates: "templates",
  paymentLogs: "paymentLogs",
  activity: "activity",
  settings: "settings",
  services: "services",
  quotations: "quotations",
  expenses: "expenses",
  leads: "leads",
  stock: "stock",
  pendingClient: "pendingClient",
  draft: "draft",
};

const NAMESPACE = "invoicepulse";
let _tenantId = "guest";

export function setTenantId(id) {
  _tenantId = id ? String(id) : "guest";
  migrateLegacyData(_tenantId);
}

export function getTenantId() {
  return _tenantId;
}

// Strict per-tenant key — every record lives under invoicepulse:u:<tenantId>:<base>.
export function tenantKey(key) {
  const base = String(key || "").replace(/^(invoicepulse:|invoicepulse-)/, "");
  return `${NAMESPACE}:u:${_tenantId}:${base}`;
}

// One-time migration: move pre-isolation (un-namespaced) data into this tenant's
// namespace, then drop the legacy keys so they can never leak to another account.
const MIGRATED_FLAG = "invoicepulse:migrated";
const LEGACY_MAP = {
  "invoicepulse:history": "history",
  "invoicepulse:businessProfile": "businessProfile",
  "invoicepulse:clients": "clients",
  "invoicepulse:templates": "templates",
  "invoicepulse:paymentLogs": "paymentLogs",
  "invoicepulse:activity": "activity",
  "invoicepulse:settings": "settings",
  "invoicepulse:services": "services",
  "invoicepulse:quotations": "quotations",
  "invoicepulse:expenses": "expenses",
  "invoicepulse:leads": "leads",
  "invoicepulse:stock": "stock",
  "invoicepulse:pendingClient": "pendingClient",
  "invoicepulse:cardVisibility": "cardVisibility",
  "invoicepulse:teamInvites": "teamInvites",
  "invoicepulse:emailSettings": "emailSettings",
  "invoicepulse_usage_count": "invoicepulse_usage_count",
  "is_premium_user": "is_premium_user",
  "invoicepulse-dark": "dark",
  "invoicepulse-draft": "draft",
};
function migrateLegacyData(tenantId) {
  try {
    if (localStorage.getItem(`${MIGRATED_FLAG}:${tenantId}`)) return;
    Object.entries(LEGACY_MAP).forEach(([legacy, base]) => {
      const scoped = `${NAMESPACE}:u:${tenantId}:${base}`;
      if (localStorage.getItem(scoped) === null && localStorage.getItem(legacy) !== null) {
        localStorage.setItem(scoped, localStorage.getItem(legacy));
      }
    });
    // Drop all legacy un-namespaced keys once copied into this tenant.
    Object.keys(LEGACY_MAP).forEach((legacy) => localStorage.removeItem(legacy));
    localStorage.setItem(`${MIGRATED_FLAG}:${tenantId}`, "1");
  } catch { /* best effort */ }
}

export function genId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Server-backed records
// ──────────────────────────────────────────────────────────────────────────
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v) => (v === null || v === undefined ? "" : String(v));
const dateOrNull = (v) => (v ? String(v).slice(0, 10) : null);

// UI record <-> database row, per table.
const MAPPERS = {
  clients: {
    toUi: (r) => ({ id: r.id, name: str(r.name), company: str(r.company), email: str(r.email), phone: str(r.phone), gstin: str(r.gstin), address: str(r.address) }),
    toDb: (i) => ({ name: str(i.name), company: str(i.company), email: str(i.email), phone: str(i.phone), gstin: str(i.gstin), address: str(i.address) }),
  },
  expenses: {
    toUi: (r) => ({ id: r.id, vendor: str(r.vendor), category: str(r.category), amount: num(r.amount), date: str(r.date).slice(0, 10), status: str(r.status), method: str(r.method), notes: str(r.notes) }),
    toDb: (i) => ({ vendor: str(i.vendor), category: i.category || "Other", amount: num(i.amount), date: dateOrNull(i.date), status: str(i.status), method: str(i.method), notes: str(i.notes) }),
  },
  stock: {
    toUi: (r) => ({ id: r.id, name: str(r.name), sku: str(r.sku), quantity: num(r.quantity), unit: str(r.unit), price: num(r.price), lowStock: r.low_stock === null || r.low_stock === undefined ? 5 : num(r.low_stock) }),
    toDb: (i) => ({ name: str(i.name), sku: str(i.sku), quantity: num(i.quantity), unit: str(i.unit), price: num(i.price), low_stock: i.lowStock === "" || i.lowStock === undefined ? 5 : num(i.lowStock) }),
  },
  services: {
    toUi: (r) => ({ id: r.id, name: str(r.name), rate: num(r.rate), gstRate: num(r.gst_rate), description: str(r.description) }),
    toDb: (i) => ({ name: str(i.name), rate: num(i.rate), gst_rate: num(i.gstRate), description: str(i.description) }),
  },
  leads: {
    toUi: (r) => ({ id: r.id, name: str(r.name), phone: str(r.phone), requirement: str(r.requirement), value: num(r.value), stage: str(r.stage) }),
    toDb: (i) => ({ name: str(i.name), phone: str(i.phone), requirement: str(i.requirement), value: num(i.value), stage: str(i.stage) }),
  },
  quotations: {
    toUi: (r) => ({ id: r.id, number: str(r.number), clientName: str(r.client_name), date: str(r.date).slice(0, 10), total: num(r.total), status: str(r.status) || "draft", taxRate: num(r.tax_rate), items: Array.isArray(r.items) ? r.items : [] }),
    toDb: (i) => ({ number: str(i.number), client_name: str(i.clientName), date: dateOrNull(i.date), total: num(i.total), status: i.status === "sent" ? "sent" : "draft", tax_rate: num(i.taxRate), items: Array.isArray(i.items) ? i.items : [] }),
  },
};
const RECORD_KEYS = Object.keys(MAPPERS); // everything except invoices (history) and the profile

const profileToUi = (r) => ({ name: str(r?.name), email: str(r?.email), phone: str(r?.phone), gstin: str(r?.gstin), address: str(r?.address), logo: str(r?.logo_url), upiId: str(r?.upi_id) });
const profileToDb = (p) => ({ name: str(p?.name), email: str(p?.email), phone: str(p?.phone), gstin: str(p?.gstin), address: str(p?.address), logo_url: str(p?.logo), upi_id: str(p?.upiId) });

const invoiceToUi = (r) => {
  const items = Array.isArray(r.invoice_items) ? r.invoice_items : [];
  return {
    id: r.id, number: str(r.number), clientName: str(r.client_name), clientEmail: str(r.client_email), businessName: str(r.business_name),
    total: num(r.total), cgst: num(r.cgst), sgst: num(r.sgst), igst: num(r.igst), taxValue: num(r.tax_value), subtotal: num(r.subtotal),
    issueDate: str(r.issue_date).slice(0, 10), dueDate: str(r.due_date).slice(0, 10), createdDate: str(r.created_at), currency: r.currency || "INR",
    itemCount: items.length, taxMode: r.tax_mode || "split", taxRate: num(r.tax_rate), status: r.status || "Pending", isDraft: !!r.is_draft,
    items: items.map((it) => ({ description: str(it.description), quantity: num(it.quantity), rate: num(it.rate), gstRate: it.gst_rate === null || it.gst_rate === undefined ? undefined : num(it.gst_rate) })),
  };
};

const cache = { history: [], profile: null };
RECORD_KEYS.forEach((k) => { cache[k] = []; });
let _hydrated = false;
const idAlias = new Map(); // temporary browser id -> real database id
const _savedSignatures = new Map(); // invoice signature -> { id, number }
const norm = (id) => idAlias.get(id) || id;

const emitError = (message) => {
  try { window.dispatchEvent(new CustomEvent("plivex-sync-error", { detail: { message } })); } catch { /* ignore */ }
};
const errText = (e) => (e && e.message) || "Request failed";

// Extra per-invoice fields the server has no column for (UTR reference, reminder settings) stay in this browser.
const OVERLAY_KEY = "invoiceOverlay";
const OVERLAY_FIELDS = ["utrReference", "reminder"];
const readOverlay = () => { try { const s = localStorage.getItem(tenantKey(OVERLAY_KEY)); return s ? JSON.parse(s) : {}; } catch { return {}; } };
const writeOverlay = (o) => { try { localStorage.setItem(tenantKey(OVERLAY_KEY), JSON.stringify(o)); } catch { /* best effort */ } };
const withOverlay = (inv, overlay) => (overlay[inv.id] ? { ...inv, ...overlay[inv.id] } : inv);

let _queue = Promise.resolve();
let _pending = 0;
const enqueue = (fn) => {
  _pending += 1;
  _queue = _queue.then(fn).catch((e) => { emitError(errText(e)); }).finally(() => { _pending -= 1; });
  return _queue;
};
export function hasPendingWrites() { return _pending > 0; }

async function fetchRecords(table) {
  const res = await api.functions.invoke("workspaceRecords", { table, action: "list" });
  return Array.isArray(res?.data?.records) ? res.data.records : [];
}
async function fetchInvoices() {
  const res = await api.functions.invoke("listInvoices", { limit: 1000 });
  return Array.isArray(res?.data?.invoices) ? res.data.invoices : [];
}
async function fetchProfile() {
  const res = await api.functions.invoke("workspaceRecords", { table: "business_profile", action: "get" });
  return res?.data?.record || null;
}

// Loads every business record for the signed-in user's workspace. A table the user's
// role cannot read simply stays empty. Called once after sign-in and on window focus.
export async function hydrateWorkspaceData() {
  const overlay = readOverlay();
  const jobs = [
    fetchInvoices().then((rows) => { cache.history = rows.map((r) => withOverlay(invoiceToUi(r), overlay)); }),
    fetchProfile().then((r) => { cache.profile = r ? profileToUi(r) : null; }),
    ...RECORD_KEYS.map((k) => fetchRecords(k).then((rows) => { cache[k] = rows.map(MAPPERS[k].toUi); })),
  ];
  await Promise.allSettled(jobs);
  _hydrated = true;
}
// Forget the in-memory business data (used on sign-out); nothing is deleted on the server.
export function resetWorkspaceCache() {
  cache.history = []; cache.profile = null; RECORD_KEYS.forEach((k) => { cache[k] = []; });
  idAlias.clear(); _savedSignatures.clear(); _hydrated = false;
}
export function isWorkspaceDataReady() { return _hydrated; }

async function refreshKey(key) {
  try {
    if (key === "history") { const overlay = readOverlay(); cache.history = (await fetchInvoices()).map((r) => withOverlay(invoiceToUi(r), overlay)); }
    else if (key === "businessProfile") { const r = await fetchProfile(); cache.profile = r ? profileToUi(r) : null; }
    else if (MAPPERS[key]) { cache[key] = (await fetchRecords(key)).map(MAPPERS[key].toUi); }
  } catch { /* keep the cache as is */ }
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function syncRecords(key, prev, next) {
  const m = MAPPERS[key];
  prev = prev.map((p) => ({ ...p, id: norm(p.id) }));
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const nextIds = new Set(next.map((n) => norm(n.id)));
  // deletions
  for (const p of prev) {
    if (!nextIds.has(p.id)) await api.functions.invoke("workspaceRecords", { table: key, action: "delete", id: p.id });
  }
  // creations and updates
  for (const n of next) {
    const realId = norm(n.id);
    const before = prevById.get(realId);
    if (!before) {
      const res = await api.functions.invoke("workspaceRecords", { table: key, action: "create", values: m.toDb(n) });
      const created = res?.data?.record;
      if (created?.id) {
        if (created.id !== n.id) idAlias.set(n.id, created.id);
        const idx = cache[key].findIndex((x) => x.id === n.id);
        if (idx >= 0) cache[key][idx] = { ...cache[key][idx], id: created.id };
      }
    } else if (!sameJson(m.toDb(before), m.toDb(n))) {
      await api.functions.invoke("workspaceRecords", { table: key, action: "update", id: realId, values: m.toDb(n) });
    }
  }
}

async function syncInvoices(prev, next) {
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const overlay = readOverlay();
  let overlayChanged = false;
  for (const n of next) {
    const before = prevById.get(n.id);
    if (!before) continue; // invoices are created only through saveInvoiceToServer
    if (before.status !== n.status && ["Pending", "Paid", "Cancelled"].includes(n.status)) {
      await api.functions.invoke("setInvoiceStatus", { id: n.id, status: n.status });
    }
    const extras = {};
    OVERLAY_FIELDS.forEach((f) => { if (n[f] !== undefined) extras[f] = n[f]; });
    if (!sameJson(extras, Object.fromEntries(OVERLAY_FIELDS.filter((f) => before[f] !== undefined).map((f) => [f, before[f]])))) {
      overlay[n.id] = { ...(overlay[n.id] || {}), ...extras }; overlayChanged = true;
    }
  }
  if (overlayChanged) writeOverlay(overlay);
}

async function syncProfile(next) {
  await api.functions.invoke("workspaceRecords", { table: "business_profile", action: "upsert", values: profileToDb(next) });
}

export function loadList(key, opts = {}) {
  if (key === KEYS.history) return cache.history.filter((i) => opts.includeCancelled || (i.status !== "Cancelled" && !i.isDraft)).slice();
  if (MAPPERS[key]) return cache[key].slice();
  try { const s = localStorage.getItem(tenantKey(key)); return s ? JSON.parse(s) : []; } catch { return []; }
}

export function saveList(key, items) {
  if (key === KEYS.history) {
    const prev = cache.history;
    const incoming = new Map(items.map((i) => [i.id, i]));
    // Keep cancelled invoices (screens may not have loaded them) and apply the incoming changes.
    cache.history = [...items, ...prev.filter((p) => !incoming.has(p.id) && p.status === "Cancelled")];
    enqueue(() => syncInvoices(prev, cache.history)).then(() => {});
    return;
  }
  if (MAPPERS[key]) {
    const prev = cache[key];
    cache[key] = items.slice();
    enqueue(async () => {
      try { await syncRecords(key, prev, items); }
      catch (e) { await refreshKey(key); throw e; }
    });
    return;
  }
  try { localStorage.setItem(tenantKey(key), JSON.stringify(items)); } catch { /* best effort */ }
}

export function pushItem(key, item) {
  const next = [item, ...loadList(key, { includeCancelled: true })];
  saveList(key, next);
  return next;
}

export function removeItem(key, id) {
  if (key === KEYS.history) {
    // Invoices are never hard-deleted: removing one marks it Cancelled (kept for GST / audit).
    const all = loadList(KEYS.history, { includeCancelled: true });
    const next = all.map((i) => (i.id === id ? { ...i, status: "Cancelled" } : i));
    saveList(KEYS.history, next);
    return next;
  }
  // A just-created record may still be known to the screen by its temporary id.
  const real = norm(id);
  const next = loadList(key).filter((it) => it.id !== id && it.id !== real);
  saveList(key, next);
  return next;
}

export function loadState(key, fallback) {
  if (key === KEYS.businessProfile) return cache.profile ? { ...cache.profile } : fallback;
  try { const s = localStorage.getItem(tenantKey(key)); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

let _profileTimer = null;
export function saveState(key, value) {
  if (key === KEYS.businessProfile) {
    const next = profileToUi(profileToDb(value));
    if (sameJson(cache.profile || profileToUi({}), next)) return;
    cache.profile = next;
    if (_profileTimer) clearTimeout(_profileTimer);
    _profileTimer = setTimeout(() => {
      enqueue(async () => { try { await syncProfile(cache.profile); } catch (e) { await refreshKey("businessProfile"); throw e; } });
    }, 700);
    return;
  }
  try { localStorage.setItem(tenantKey(key), JSON.stringify(value)); } catch { /* best effort */ }
}
export function removeState(key) {
  try { localStorage.removeItem(tenantKey(key)); } catch { /* best effort */ }
}

// Drop every workspace-scoped business record for the current user — used when
// leaving/switching a workspace so no previous workspace's data carries over.
export function clearWorkspaceData() {
  try {
    const bases = [...Object.values(KEYS), "cardVisibility", "teamInvites", "emailSettings", OVERLAY_KEY];
    bases.forEach((base) => localStorage.removeItem(tenantKey(base)));
  } catch { /* best effort */ }
  cache.history = []; cache.profile = null; RECORD_KEYS.forEach((k) => { cache[k] = []; });
  idAlias.clear(); _hydrated = false;
}

export function useLocalState(key, fallback) {
  const [value, setValue] = useState(() => loadState(key, fallback));
  useEffect(() => { saveState(key, value); }, [key, value]);
  return [value, setValue];
}

// ── Saving an invoice (the server calculates totals, the invoice number and the stock change) ──

const invoiceSignature = (inv) => JSON.stringify([
  inv.client?.name, inv.client?.email, inv.business?.name, inv.issueDate, inv.dueDate, inv.currency, inv.taxMode, inv.taxRate,
  inv.discountType, inv.discount, inv.notes, inv.terms,
  (inv.items || []).map((i) => [i.description, i.quantity, i.rate, i.gstRate]),
]);

export async function saveInvoiceToServer(inv) {
  const sig = invoiceSignature(inv);
  const already = _savedSignatures.get(sig);
  if (already) return already; // same invoice downloaded or shared again: do not create a duplicate
  const payload = {
    items: (inv.items || []).map((i) => ({
      description: str(i.description), quantity: num(i.quantity), rate: num(i.rate),
      ...(i.gstRate === "" || i.gstRate === undefined || i.gstRate === null ? {} : { gst_rate: num(i.gstRate) }),
    })),
    tax_mode: inv.taxMode === "igst" ? "igst" : "split",
    tax_rate: num(inv.taxRate),
    discount_type: inv.discountType === "flat" ? "flat" : "percent",
    discount: num(inv.discount),
    is_draft: false,
    status: "Pending",
    client_name: str(inv.client?.name), client_email: str(inv.client?.email), business_name: str(inv.business?.name),
    issue_date: dateOrNull(inv.issueDate) || new Date().toISOString().slice(0, 10),
    due_date: dateOrNull(inv.dueDate),
    currency: inv.currency || "INR", notes: str(inv.notes), terms: str(inv.terms),
  };
  const res = await api.functions.invoke("saveInvoice", payload);
  const saved = res?.data?.invoice;
  if (!saved?.id) throw new Error("The invoice could not be saved.");
  const ui = invoiceToUi(saved);
  cache.history = [ui, ...cache.history.filter((i) => i.id !== ui.id)];
  const result = { id: ui.id, number: ui.number };
  _savedSignatures.set(sig, result);
  refreshKey("stock"); // the server may have reduced stock
  return result;
}

// Stock is now reduced by the server when an invoice is saved.
export function deductStockForInvoice() { return false; }
