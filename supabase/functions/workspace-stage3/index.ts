import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const EVENT_TYPES = new Set(["invoice.created","invoice.status_changed","lead.created","lead.stage_changed","expense.created","stock.low_stock"]);
const MIME_TYPES = new Set(["application/pdf","image/jpeg","image/png","image/webp","text/csv"]);
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 14 * 1024 * 1024;
const allowedOrigin = (origin: string | null) => !origin || ORIGINS.has(origin) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:pages|workers)\.dev$/.test(origin);
const headers = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigin(origin) ? origin : "https://plivex.in",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const isObject = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const sha256 = async (value: Uint8Array | string) => {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const fromBase64 = (value: string) => {
  if (value.length > Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 8) throw new Error("DOCUMENT_TOO_LARGE");
  const raw = atob(value);
  if (raw.length > MAX_DOCUMENT_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
};
const safeFileName = (value: string) => clean(value, 255).replace(/[\/\\]/g, "_").replace(/[\u0000-\u001f]/g, "_").replace(/^\.+$/, "document") || "document";

async function setup(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) throw new Error("SERVICE_NOT_CONFIGURED");
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
  const authClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error || !user) throw new Error("AUTH_REQUIRED");
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin.from("profiles").select("workspace_id").eq("id", user.id).maybeSingle();
  if (profileError || !profile?.workspace_id) throw new Error("WORKSPACE_NOT_FOUND");
  const { data: membership, error: membershipError } = await admin.from("workspace_members").select("role,status").eq("workspace_id", profile.workspace_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (membershipError) throw new Error("WORKSPACE_MEMBERSHIP_CHECK_FAILED");
  if (!membership) throw new Error("WORKSPACE_MEMBERSHIP_REQUIRED");
  return { admin, user, workspaceId: String(profile.workspace_id), role: String(membership.role || "") };
}
const canManage = (role: string) => ["admin","manager"].includes(role);
const canUseVault = (role: string) => ["admin","manager","accountant"].includes(role);

async function ensureVaultBucket(admin: any) {
  const bucket = "plivex-workspace-vault";
  const { data, error } = await admin.storage.listBuckets();
  if (error) throw new Error("STORAGE_UNAVAILABLE");
  const existing = (data || []).find((item: any) => item.name === bucket);
  if (existing) {
    if (existing.public !== false) throw new Error("PRIVATE_VAULT_BUCKET_REQUIRED");
    return bucket;
  }
  const { error: createError } = await admin.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: MAX_DOCUMENT_BYTES,
    allowedMimeTypes: [...MIME_TYPES],
  });
  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) throw new Error("VAULT_BUCKET_CREATE_FAILED");
  return bucket;
}

async function listIntegrations(ctx: any) {
  if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
  const defaults = [
    { provider_key: "shopify", status: "setup_required" },
    { provider_key: "whatsapp_cloud", status: "awaiting_provider_access" },
    { provider_key: "cashfree", status: "awaiting_provider_access" },
    { provider_key: "paddle", status: "awaiting_provider_access" },
    { provider_key: "public_api", status: "available" },
    { provider_key: "custom_webhooks", status: "setup_required" },
  ];
  const { error: seedError } = await ctx.admin.from("workspace_integrations").upsert(
    defaults.map((item) => ({ workspace_id: ctx.workspaceId, ...item })),
    { onConflict: "workspace_id,provider_key", ignoreDuplicates: true },
  );
  if (seedError) throw new Error("INTEGRATION_REGISTRY_UNAVAILABLE");
  const { data, error } = await ctx.admin.from("workspace_integrations")
    .select("id,provider_key,status,account_label,safe_metadata,last_checked_at,verified_at,last_error_code,created_at,updated_at")
    .eq("workspace_id", ctx.workspaceId).order("provider_key");
  if (error) throw new Error("INTEGRATION_REGISTRY_UNAVAILABLE");
  return { ok: true, integrations: data || [] };
}

function matchesRule(rule: any, event: any) {
  const conditions = isObject(rule.conditions) ? rule.conditions : {};
  if (conditions.status_equals && String(event.payload?.status || "") !== conditions.status_equals) return false;
  if (conditions.stage_equals && String(event.payload?.stage || "") !== conditions.stage_equals) return false;
  return true;
}

async function handleVault(ctx: any, body: any) {
  if (!canUseVault(ctx.role)) throw new Error("ACCESS_DENIED");
  const bucket = await ensureVaultBucket(ctx.admin);
  if (body.action === "vault.list") {
    const { data, error } = await ctx.admin.from("workspace_documents")
      .select("id,file_name,mime_type,size_bytes,sha256,category,retention_until,created_at,created_by")
      .eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error("VAULT_LIST_FAILED");
    return { ok: true, documents: data || [] };
  }
  if (body.action === "vault.upload") {
    const fileName = safeFileName(body.fileName);
    const mimeType = String(body.mimeType || "");
    if (!MIME_TYPES.has(mimeType) || typeof body.fileBase64 !== "string") throw new Error("INVALID_DOCUMENT");
    const bytes = fromBase64(body.fileBase64);
    if (!bytes.length) throw new Error("INVALID_DOCUMENT");
    const digest = await sha256(bytes);
    const path = ctx.workspaceId + "/" + crypto.randomUUID() + "/" + fileName;
    const { error: uploadError } = await ctx.admin.storage.from(bucket).upload(path, bytes, {
      contentType: mimeType, upsert: false, cacheControl: "3600",
    });
    if (uploadError) throw new Error("VAULT_UPLOAD_FAILED");
    const category = ["general","invoice","quotation","purchase","expense","tax","contract","other"].includes(body.category) ? body.category : "general";
    const retentionUntil = typeof body.retentionUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.retentionUntil) ? body.retentionUntil : null;
    const { data, error } = await ctx.admin.from("workspace_documents").insert({
      workspace_id: ctx.workspaceId, storage_path: path, file_name: fileName, mime_type: mimeType,
      size_bytes: bytes.byteLength, sha256: digest, category, retention_until: retentionUntil, created_by: ctx.user.id,
    }).select("id,file_name,mime_type,size_bytes,sha256,category,retention_until,created_at").single();
    if (error || !data) {
      await ctx.admin.storage.from(bucket).remove([path]);
      throw new Error("VAULT_METADATA_SAVE_FAILED");
    }
    await ctx.admin.from("workspace_audit_events").insert({
      workspace_id: ctx.workspaceId, actor_id: ctx.user.id, action: "document.vault_uploaded",
      entity_type: "workspace_document", entity_id: data.id, metadata: { category, mime_type: mimeType, size_bytes: bytes.byteLength },
    });
    return { ok: true, document: data };
  }
  if (body.action === "vault.download") {
    if (typeof body.documentId !== "string") throw new Error("INVALID_DOCUMENT_ID");
    const { data: document, error } = await ctx.admin.from("workspace_documents")
      .select("storage_path,file_name").eq("workspace_id", ctx.workspaceId).eq("id", body.documentId).maybeSingle();
    if (error || !document) throw new Error("DOCUMENT_NOT_FOUND");
    const { data, error: signedError } = await ctx.admin.storage.from(bucket).createSignedUrl(document.storage_path, 60, { download: document.file_name });
    if (signedError || !data?.signedUrl) throw new Error("DOCUMENT_DOWNLOAD_FAILED");
    return { ok: true, signedUrl: data.signedUrl, expiresInSeconds: 60 };
  }
  if (body.action === "vault.delete") {
    if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
    if (typeof body.documentId !== "string") throw new Error("INVALID_DOCUMENT_ID");
    const { data: document, error } = await ctx.admin.from("workspace_documents")
      .select("id,storage_path").eq("workspace_id", ctx.workspaceId).eq("id", body.documentId).maybeSingle();
    if (error || !document) throw new Error("DOCUMENT_NOT_FOUND");
    const { error: storageError } = await ctx.admin.storage.from(bucket).remove([document.storage_path]);
    if (storageError) throw new Error("DOCUMENT_STORAGE_DELETE_FAILED");
    const { error: deleteError } = await ctx.admin.from("workspace_documents").delete().eq("workspace_id", ctx.workspaceId).eq("id", document.id);
    if (deleteError) throw new Error("DOCUMENT_METADATA_DELETE_FAILED");
    await ctx.admin.from("workspace_audit_events").insert({
      workspace_id: ctx.workspaceId, actor_id: ctx.user.id, action: "document.vault_deleted",
      entity_type: "workspace_document", entity_id: document.id, metadata: {},
    });
    return { ok: true };
  }
  throw new Error("UNKNOWN_VAULT_ACTION");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!allowedOrigin(origin)) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, origin);

  try {
    const ctx = await setup(req);
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > MAX_REQUEST_BYTES) return json({ ok: false, error: "REQUEST_TOO_LARGE" }, 413, origin);
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) return json({ ok: false, error: "REQUEST_TOO_LARGE" }, 413, origin);
    let body: any;
    try { body = JSON.parse(rawBody); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400, origin); }
    if (!isObject(body) || typeof body.action !== "string") return json({ ok: false, error: "INVALID_REQUEST" }, 400, origin);

    if (body.action === "integrations.list") return json(await listIntegrations(ctx), 200, origin);
    if (body.action === "automation.list") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      const [{ data: rules, error: ruleError }, { data: tasks, error: taskError }] = await Promise.all([
        ctx.admin.from("workspace_automation_rules").select("id,name,event_type,conditions,action_type,action_config,timezone,is_active,created_at,updated_at").eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }),
        ctx.admin.from("workspace_automation_tasks").select("id,rule_id,source_event_id,title,description,due_at,status,created_at,completed_at").eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }).limit(100),
      ]);
      if (ruleError || taskError) throw new Error("AUTOMATION_LIST_FAILED");
      return json({ ok: true, rules: rules || [], tasks: tasks || [] }, 200, origin);
    }
    if (body.action === "automation.create") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      const name = clean(body.name, 100), eventType = clean(body.eventType, 80);
      const config = isObject(body.actionConfig) ? body.actionConfig : {};
      const conditions = isObject(body.conditions) ? body.conditions : {};
      if (name.length < 2 || !EVENT_TYPES.has(eventType) || body.actionType !== "create_task") throw new Error("INVALID_AUTOMATION");
      if (Object.keys(conditions).some((key) => !["status_equals","stage_equals"].includes(key))
        || (conditions.status_equals !== undefined && (typeof conditions.status_equals !== "string" || conditions.status_equals.length > 40))
        || (conditions.stage_equals !== undefined && !["new","qualified","proposal","negotiation","won","lost"].includes(String(conditions.stage_equals)))) throw new Error("INVALID_AUTOMATION_CONDITIONS");
      const title = clean(config.title || name, 160), description = clean(config.description, 2000);
      const dueHours = config.due_in_hours === undefined || config.due_in_hours === null ? null : Number(config.due_in_hours);
      if (title.length < 2 || (dueHours !== null && (!Number.isInteger(dueHours) || dueHours < 0 || dueHours > 720))) throw new Error("INVALID_AUTOMATION_ACTION");
      const timezone = clean(body.timezone || "UTC", 80);
      try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date()); } catch { throw new Error("INVALID_TIMEZONE"); }
      const { data, error } = await ctx.admin.from("workspace_automation_rules").insert({
        workspace_id: ctx.workspaceId, name, event_type: eventType, conditions,
        action_type: "create_task", action_config: { title, description, due_in_hours: dueHours },
        timezone, created_by: ctx.user.id,
      }).select("id,name,event_type,conditions,action_type,action_config,timezone,is_active,created_at").single();
      if (error || !data) throw new Error("AUTOMATION_CREATE_FAILED");
      await ctx.admin.from("workspace_audit_events").insert({
        workspace_id: ctx.workspaceId, actor_id: ctx.user.id, action: "automation.rule_created",
        entity_type: "automation_rule", entity_id: data.id, metadata: { event_type: eventType, action_type: "create_task" },
      });
      return json({ ok: true, rule: data }, 201, origin);
    }
    if (body.action === "automation.pause") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      if (typeof body.ruleId !== "string" || typeof body.isActive !== "boolean") throw new Error("INVALID_AUTOMATION");
      const { data, error } = await ctx.admin.from("workspace_automation_rules").update({ is_active: body.isActive, updated_at: new Date().toISOString() })
        .eq("workspace_id", ctx.workspaceId).eq("id", body.ruleId).select("id,is_active").maybeSingle();
      if (error || !data) throw new Error("AUTOMATION_RULE_NOT_FOUND");
      await ctx.admin.from("workspace_audit_events").insert({
        workspace_id: ctx.workspaceId, actor_id: ctx.user.id, action: data.is_active ? "automation.rule_enabled" : "automation.rule_paused",
        entity_type: "automation_rule", entity_id: data.id, metadata: {},
      });
      return json({ ok: true, rule: data }, 200, origin);
    }
    if (body.action === "automation.task_status") {
      if (!canUseVault(ctx.role)) throw new Error("ACCESS_DENIED");
      if (typeof body.taskId !== "string" || !["open","completed","dismissed"].includes(String(body.status))) throw new Error("INVALID_TASK_STATUS");
      const { data, error } = await ctx.admin.from("workspace_automation_tasks").update({
        status: body.status, completed_at: body.status === "completed" ? new Date().toISOString() : null,
      }).eq("workspace_id", ctx.workspaceId).eq("id", body.taskId).select("id,status").maybeSingle();
      if (error || !data) throw new Error("AUTOMATION_TASK_NOT_FOUND");
      return json({ ok: true, task: data }, 200, origin);
    }
    if (body.action.startsWith("vault.")) return json(await handleVault(ctx, body), 200, origin);
    throw new Error("UNKNOWN_ACTION");
  } catch (caught) {
    const code = caught instanceof Error ? caught.message : "REQUEST_FAILED";
    const status = code === "AUTH_REQUIRED" ? 401
      : code === "ACCESS_DENIED" || code === "WORKSPACE_MEMBERSHIP_REQUIRED" ? 403
      : code === "DOCUMENT_NOT_FOUND" || code === "AUTOMATION_RULE_NOT_FOUND" || code === "AUTOMATION_TASK_NOT_FOUND" ? 404
      : code.includes("NOT_CONFIGURED") || code.includes("UNAVAILABLE") ? 503
      : code.startsWith("INVALID_") || code.endsWith("_REQUIRED") || code === "DOCUMENT_TOO_LARGE" ? 400 : 500;
    return json({ ok: false, error: code }, status, origin);
  }
});
