import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isAllowedWebhookEvent, verifyCustomWebhookSignature, verifyShopifyWebhookSignature } from "../_shared/webhook-security.ts";

const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const EVENT_TYPES = new Set(["invoice.created","invoice.status_changed","lead.created","lead.stage_changed","expense.created","stock.low_stock","integration.webhook_received"]);
const MIME_TYPES = new Set(["application/pdf","image/jpeg","image/png","image/webp","text/csv"]);
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 14 * 1024 * 1024;
const MAX_WEBHOOK_BYTES = 200 * 1024;
const allowedOrigin = (origin: string | null) => !origin || ORIGINS.has(origin) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:pages|workers)\.dev$/.test(origin);
const headers = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigin(origin) ? origin : "https://plivex.in",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-correlation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const isObject = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const sha256 = async (value: Uint8Array | string) => {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const stableBuffer = new Uint8Array(input.byteLength);
  stableBuffer.set(input);
  const digest = await crypto.subtle.digest("SHA-256", stableBuffer.buffer);
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
  const candidateCorrelationId = req.headers.get("x-correlation-id") || "";
  const correlationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateCorrelationId) ? candidateCorrelationId : crypto.randomUUID();
  return { admin, user, workspaceId: String(profile.workspace_id), role: String(membership.role || ""), correlationId };
}
const canManage = (role: string) => ["admin","manager"].includes(role);
const canUseVault = (role: string) => ["admin","manager","accountant"].includes(role);

async function writeAudit(ctx: any, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
  const { error } = await ctx.admin.from("workspace_audit_events").insert({
    workspace_id: ctx.workspaceId,
    actor_id: ctx.user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    correlation_id: ctx.correlationId,
    outcome: "success",
    metadata,
  });
  if (error) throw new Error("AUDIT_WRITE_FAILED");
}

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

async function handleWebhookRequest(req: Request) {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const match = new URL(req.url).pathname.match(/\/webhooks\/([0-9a-f-]{36})$/i);
  if (!match) return json({ ok: false, error: "WEBHOOK_SUBSCRIPTION_NOT_FOUND" }, 404);
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) return json({ ok: false, error: "WEBHOOK_PAYLOAD_TOO_LARGE" }, 413);
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) return json({ ok: false, error: "WEBHOOK_PAYLOAD_TOO_LARGE" }, 413);
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return json({ ok: false, error: "WEBHOOK_INVALID_JSON" }, 400); }
  if (!isObject(payload)) return json({ ok: false, error: "WEBHOOK_INVALID_PAYLOAD" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ ok: false, error: "WEBHOOK_BACKEND_UNAVAILABLE" }, 503);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const subscriptionId = match[1];
  const { data: subscription, error: subscriptionError } = await admin.from("workspace_webhook_subscriptions")
    .select("id,workspace_id,provider_key,event_types,is_active")
    .eq("id", subscriptionId).maybeSingle();
  if (subscriptionError || !subscription || !subscription.is_active) return json({ ok: false, error: "WEBHOOK_SUBSCRIPTION_NOT_FOUND" }, 404);

  const provider = String(subscription.provider_key);
  let secret: string | null = null;
  if (provider === "shopify") {
    secret = Deno.env.get("SHOPIFY_API_SECRET") || null;
    if (!secret || secret.length < 32) return json({ ok: false, error: "SHOPIFY_PROVIDER_SECRET_NOT_CONFIGURED" }, 503);
  } else {
    const { data: customSecret, error: secretError } = await admin.rpc("main_workspace_get_webhook_secret", { p_subscription_id: subscription.id });
    if (secretError || typeof customSecret !== "string" || customSecret.length < 32) return json({ ok: false, error: "WEBHOOK_SECRET_UNAVAILABLE" }, 503);
    secret = customSecret;
  }
  const eventType = clean(provider === "shopify" ? req.headers.get("x-shopify-topic") : req.headers.get("x-plivex-event-type"), 120);
  const eventId = String((provider === "shopify" ? req.headers.get("x-shopify-webhook-id") : req.headers.get("x-plivex-event-id")) || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(eventId) || !isAllowedWebhookEvent(provider, eventType, subscription.event_types)) {
    return json({ ok: false, error: "WEBHOOK_EVENT_NOT_ALLOWED" }, 400);
  }

  let eventTimestamp: string | null = null;
  if (provider === "shopify") {
    const signature = clean(req.headers.get("x-shopify-hmac-sha256"), 128);
    if (!await verifyShopifyWebhookSignature(secret, signature, rawBody)) return json({ ok: false, error: "WEBHOOK_SIGNATURE_INVALID" }, 401);
    const triggeredAt = req.headers.get("x-shopify-triggered-at");
    if (triggeredAt && Number.isFinite(Date.parse(triggeredAt))) eventTimestamp = new Date(triggeredAt).toISOString();
  } else {
    const timestamp = String(req.headers.get("x-plivex-timestamp") || "").trim();
    const signature = String(req.headers.get("x-plivex-signature") || "").trim();
    const verified = await verifyCustomWebhookSignature(secret, timestamp, eventId, signature, rawBody);
    if (!verified.ok) return json({ ok: false, error: verified.code || "WEBHOOK_SIGNATURE_INVALID" }, 401);
    eventTimestamp = new Date(Number(timestamp) * 1000).toISOString();
  }

  const payloadHash = await sha256(rawBody);
  const { data: event, error: insertError } = await admin.from("workspace_webhook_events").insert({
    workspace_id: subscription.workspace_id,
    subscription_id: subscription.id,
    provider_key: provider,
    provider_event_id: eventId,
    event_type: eventType,
    event_timestamp: eventTimestamp,
    payload,
    payload_sha256: payloadHash,
    signature_verified: true,
  }).select("id,attempt_count,status").single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: existing } = await admin.from("workspace_webhook_events")
        .select("id,attempt_count,status").eq("subscription_id", subscription.id).eq("provider_event_id", eventId).maybeSingle();
      if (existing) {
        await admin.from("workspace_webhook_attempts").insert({
          workspace_id: subscription.workspace_id, event_id: existing.id, attempt_no: existing.attempt_count,
          status: "duplicate", metadata: { provider_key: provider },
        });
        return json({ ok: true, duplicate: true, status: existing.status }, 200);
      }
    }
    return json({ ok: false, error: "WEBHOOK_RECEIPT_SAVE_FAILED" }, 503);
  }

  await admin.from("workspace_webhook_attempts").insert({
    workspace_id: subscription.workspace_id, event_id: event.id, attempt_no: 0,
    status: "accepted", metadata: { provider_key: provider },
  });
  await admin.from("workspace_webhook_subscriptions").update({ last_received_at: new Date().toISOString() }).eq("id", subscription.id);
  return json({ ok: true, received: true, status: event.status }, 202);
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
  const { data: hooks, error: hookError } = await ctx.admin.from("workspace_webhook_subscriptions")
    .select("provider_key,is_active").eq("workspace_id", ctx.workspaceId);
  if (hookError) throw new Error("INTEGRATION_REGISTRY_UNAVAILABLE");
  const configuredProviders = new Set((hooks || []).map((item: any) => item.provider_key));
  for (const [providerKey, label] of [["shopify","Shopify webhook endpoint configured"],["custom_webhooks","Signed custom webhook configured"]] as const) {
    if (configuredProviders.has(providerKey === "custom_webhooks" ? "custom" : providerKey)) {
      await ctx.admin.from("workspace_integrations").update({
        status: "awaiting_provider_access", account_label: label,
      }).eq("workspace_id", ctx.workspaceId).eq("provider_key", providerKey).in("status", ["setup_required","available"]);
    }
  }
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
  if (conditions.provider_key_equals && String(event.payload?.provider_key || "") !== conditions.provider_key_equals) return false;
  if (conditions.webhook_event_type_equals && String(event.payload?.event_type || "") !== conditions.webhook_event_type_equals) return false;
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
    await writeAudit(ctx, "document.vault_uploaded", "workspace_document", data.id, { category, mime_type: mimeType, size_bytes: bytes.byteLength });
    return { ok: true, document: data };
  }
  if (body.action === "vault.download") {
    if (typeof body.documentId !== "string") throw new Error("INVALID_DOCUMENT_ID");
    const { data: document, error } = await ctx.admin.from("workspace_documents")
      .select("storage_path,file_name").eq("workspace_id", ctx.workspaceId).eq("id", body.documentId).maybeSingle();
    if (error || !document) throw new Error("DOCUMENT_NOT_FOUND");
    const { data, error: signedError } = await ctx.admin.storage.from(bucket).createSignedUrl(document.storage_path, 60, { download: document.file_name });
    if (signedError || !data?.signedUrl) throw new Error("DOCUMENT_DOWNLOAD_FAILED");
    await writeAudit(ctx, "document.vault_downloaded", "workspace_document", body.documentId, { expires_in_seconds: 60 });
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
    await writeAudit(ctx, "document.vault_deleted", "workspace_document", document.id);
    return { ok: true };
  }
  throw new Error("UNKNOWN_VAULT_ACTION");
}

Deno.serve(async (req: Request) => {
  if (new URL(req.url).pathname.includes("/webhooks/")) return await handleWebhookRequest(req);
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

    if (body.action === "webhooks.list") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      const [{ data: subscriptions, error: subscriptionError }, { data: events, error: eventError }] = await Promise.all([
        ctx.admin.from("workspace_webhook_subscriptions").select("id,provider_key,label,event_types,is_active,last_received_at,created_at").eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }),
        ctx.admin.from("workspace_webhook_events").select("id,subscription_id,provider_key,provider_event_id,event_type,status,attempt_count,next_attempt_at,last_error_code,received_at,processed_at").eq("workspace_id", ctx.workspaceId).order("received_at", { ascending: false }).limit(100),
      ]);
      if (subscriptionError || eventError) throw new Error("WEBHOOK_LIST_FAILED");
      const eventIds = (events || []).map((item: any) => item.id);
      const { data: attempts, error: attemptsError } = eventIds.length
        ? await ctx.admin.from("workspace_webhook_attempts").select("id,event_id,attempt_no,status,error_code,occurred_at").eq("workspace_id", ctx.workspaceId).in("event_id", eventIds).order("occurred_at", { ascending: false }).limit(200)
        : { data: [], error: null };
      if (attemptsError) throw new Error("WEBHOOK_ATTEMPTS_LIST_FAILED");
      const baseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") || "";
      const subscriptionItems = (subscriptions || []).map((item: any) => ({
        ...item,
        endpoint_url: baseUrl ? baseUrl + "/functions/v1/workspace-stage3/webhooks/" + item.id : null,
      }));
      return json({ ok: true, subscriptions: subscriptionItems, events: events || [], attempts: attempts || [] }, 200, origin);
    }
    if (body.action === "webhooks.create") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      const providerKey = clean(body.providerKey, 20);
      const label = clean(body.label, 100);
      const eventTypes = Array.isArray(body.eventTypes) ? body.eventTypes : [];
      if (!["shopify","custom"].includes(providerKey) || label.length < 2 || eventTypes.length < 1 || eventTypes.length > 8
        || new Set(eventTypes).size !== eventTypes.length
        || !eventTypes.every((item: unknown) => typeof item === "string" && isAllowedWebhookEvent(providerKey, item, eventTypes))) {
        throw new Error("INVALID_WEBHOOK_SUBSCRIPTION");
      }
      const { data, error } = await ctx.admin.rpc("main_workspace_create_webhook_subscription", {
        p_workspace_id: ctx.workspaceId, p_user_id: ctx.user.id, p_provider_key: providerKey,
        p_label: label, p_event_types: eventTypes,
      });
      if (error || !data?.ok) throw new Error(data?.error || "WEBHOOK_SUBSCRIPTION_CREATE_FAILED");
      const baseUrl = Deno.env.get("SUPABASE_URL");
      if (!baseUrl) throw new Error("WEBHOOK_ENDPOINT_NOT_CONFIGURED");
      const endpointUrl = baseUrl.replace(/\/$/, "") + "/functions/v1/workspace-stage3/webhooks/" + data.subscription_id;
      return json({
        ok: true,
        subscription: { id: data.subscription_id, provider_key: data.provider_key, event_types: data.event_types },
        endpointUrl,
        secret: data.secret || null,
        secretShownOnce: Boolean(data.secret),
        shopifySecretSetupRequired: providerKey === "shopify" && !Deno.env.get("SHOPIFY_API_SECRET"),
      }, 201, origin);
    }
    if (body.action === "webhooks.pause") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      if (typeof body.subscriptionId !== "string" || typeof body.isActive !== "boolean") throw new Error("INVALID_WEBHOOK_SUBSCRIPTION");
      const { data, error } = await ctx.admin.from("workspace_webhook_subscriptions")
        .update({ is_active: body.isActive, updated_at: new Date().toISOString() })
        .eq("workspace_id", ctx.workspaceId).eq("id", body.subscriptionId).select("id,is_active").maybeSingle();
      if (error || !data) throw new Error("WEBHOOK_SUBSCRIPTION_NOT_FOUND");
      await writeAudit(ctx, data.is_active ? "webhook.subscription_enabled" : "webhook.subscription_paused", "webhook_subscription", data.id);
      return json({ ok: true, subscription: data }, 200, origin);
    }
    if (body.action === "webhooks.replay") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      if (typeof body.eventId !== "string") throw new Error("INVALID_WEBHOOK_EVENT");
      const { data, error } = await ctx.admin.from("workspace_webhook_events")
        .update({ status: "pending", attempt_count: 0, next_attempt_at: new Date().toISOString(), last_error_code: null, processed_at: null })
        .eq("workspace_id", ctx.workspaceId).eq("id", body.eventId).eq("status", "dead_letter")
        .select("id").maybeSingle();
      if (error || !data) throw new Error("WEBHOOK_EVENT_NOT_REPLAYABLE");
      await ctx.admin.from("workspace_webhook_attempts").insert({
        workspace_id: ctx.workspaceId, event_id: data.id, attempt_no: 0, status: "accepted", metadata: { manual_replay: true },
      });
      await writeAudit(ctx, "webhook.event_replayed", "webhook_event", data.id);
      return json({ ok: true, eventId: data.id }, 200, origin);
    }
    if (body.action === "integrations.list") return json(await listIntegrations(ctx), 200, origin);
    if (body.action === "automation.list") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      const [rulesResult,tasksResult,runsResult,eventsResult,prefsResult,notificationsResult] = await Promise.all([
        ctx.admin.from("workspace_automation_rules").select("id,name,event_type,trigger_type,conditions,action_type,action_config,timezone,schedule_frequency,schedule_time_local,schedule_days_of_week,next_run_at,is_active,created_at,updated_at").eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }),
        ctx.admin.from("workspace_automation_tasks").select("id,rule_id,source_event_id,title,description,due_at,status,escalated_at,escalation_count,created_at,completed_at").eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }).limit(100),
        ctx.admin.from("workspace_automation_runs").select("id,rule_id,event_id,status,error_code,attempt_no,started_at,completed_at").eq("workspace_id", ctx.workspaceId).order("started_at", { ascending: false }).limit(100),
        ctx.admin.from("workspace_event_outbox").select("id,event_type,entity_type,entity_id,processing_status,attempt_count,processing_error_code,next_attempt_at,created_at").eq("workspace_id", ctx.workspaceId).in("processing_status", ["retrying","dead_letter"]).order("created_at", { ascending: false }).limit(50),
        ctx.admin.from("workspace_automation_preferences").select("timezone,reminders_enabled,quiet_hours_start,quiet_hours_end,escalation_enabled,escalation_after_hours,updated_at").eq("workspace_id", ctx.workspaceId).maybeSingle(),
        ctx.admin.from("workspace_automation_notifications").select("id,task_id,notification_type,title,message,available_at,read_at,created_at").eq("workspace_id", ctx.workspaceId).lte("available_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(50),
      ]);
      if (rulesResult.error || tasksResult.error || runsResult.error || eventsResult.error || prefsResult.error || notificationsResult.error) throw new Error("AUTOMATION_LIST_FAILED");
      return json({
        ok: true,
        rules: rulesResult.data || [],
        tasks: tasksResult.data || [],
        runs: runsResult.data || [],
        failedEvents: eventsResult.data || [],
        preferences: prefsResult.data || { timezone: "UTC", reminders_enabled: true, quiet_hours_start: "22:00:00", quiet_hours_end: "08:00:00", escalation_enabled: false, escalation_after_hours: 24 },
        notifications: notificationsResult.data || [],
      }, 200, origin);
    }
    if (body.action === "automation.preview") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      const config = isObject(body.actionConfig) ? body.actionConfig : {};
      const title = clean(config.title || body.name || "Review business event", 160);
      const description = clean(config.description, 2000);
      const dueHours = config.due_in_hours === undefined || config.due_in_hours === null ? null : Number(config.due_in_hours);
      if (title.length < 2 || (dueHours !== null && (!Number.isInteger(dueHours) || dueHours < 0 || dueHours > 720))) throw new Error("INVALID_AUTOMATION_ACTION");
      const timezone = clean(body.timezone || "UTC", 80);
      try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date()); } catch { throw new Error("INVALID_TIMEZONE"); }
      const triggerType = body.triggerType === "schedule" ? "schedule" : "event";
      let nextRunAt: string | null = null;
      if (triggerType === "schedule") {
        const frequency = clean(body.scheduleFrequency, 10);
        const time = clean(body.scheduleTimeLocal, 5);
        const days = Array.isArray(body.scheduleDays) ? body.scheduleDays.map(Number) : null;
        if (!["daily","weekly"].includes(frequency) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
          || (frequency === "daily" && days !== null && days.length > 0)
          || (frequency === "weekly" && (!days || days.length < 1 || days.length > 7 || days.some((d: number) => !Number.isInteger(d) || d < 1 || d > 7) || new Set(days).size !== days.length))) throw new Error("INVALID_AUTOMATION_SCHEDULE");
        const { data, error } = await ctx.admin.rpc("main_workspace_next_automation_run_at", { p_timezone: timezone, p_frequency: frequency, p_time: time + ":00", p_days: days });
        if (error || !data) throw new Error("INVALID_AUTOMATION_SCHEDULE");
        nextRunAt = data;
      }
      return json({ ok: true, dryRun: true, triggerType, nextRunAt, taskPreview: { title, description, due_at: dueHours === null ? null : new Date(Date.now() + dueHours * 3600000).toISOString(), timezone }, sideEffects: ["create_task"], externalMessages: false, financialWrites: false }, 200, origin);
    }
    if (body.action === "automation.create") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      const name = clean(body.name, 100);
      const config = isObject(body.actionConfig) ? body.actionConfig : {};
      const conditions = isObject(body.conditions) ? body.conditions : {};
      const triggerType = body.triggerType === "schedule" ? "schedule" : "event";
      const eventType = triggerType === "schedule" ? "automation.schedule_due" : clean(body.eventType, 80);
      if (name.length < 2 || (triggerType === "event" && !EVENT_TYPES.has(eventType)) || body.actionType !== "create_task") throw new Error("INVALID_AUTOMATION");
      if (Object.keys(conditions).some((key) => !["status_equals","stage_equals","provider_key_equals","webhook_event_type_equals"].includes(key))
        || (conditions.status_equals !== undefined && (typeof conditions.status_equals !== "string" || conditions.status_equals.length > 40))
        || (conditions.stage_equals !== undefined && !["new","qualified","proposal","negotiation","won","lost"].includes(String(conditions.stage_equals)))
        || (conditions.provider_key_equals !== undefined && !["shopify","custom"].includes(String(conditions.provider_key_equals)))
        || (conditions.webhook_event_type_equals !== undefined && (typeof conditions.webhook_event_type_equals !== "string" || conditions.webhook_event_type_equals.length > 120))) throw new Error("INVALID_AUTOMATION_CONDITIONS");
      const title = clean(config.title || name, 160), description = clean(config.description, 2000);
      const dueHours = config.due_in_hours === undefined || config.due_in_hours === null ? null : Number(config.due_in_hours);
      if (title.length < 2 || (dueHours !== null && (!Number.isInteger(dueHours) || dueHours < 0 || dueHours > 720))) throw new Error("INVALID_AUTOMATION_ACTION");
      const timezone = clean(body.timezone || "UTC", 80);
      try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date()); } catch { throw new Error("INVALID_TIMEZONE"); }

      let scheduleFrequency: string | null = null;
      let scheduleTimeLocal: string | null = null;
      let scheduleDays: number[] | null = null;
      let nextRunAt: string | null = null;
      if (triggerType === "schedule") {
        scheduleFrequency = clean(body.scheduleFrequency, 10);
        scheduleTimeLocal = clean(body.scheduleTimeLocal, 5);
        scheduleDays = Array.isArray(body.scheduleDays) ? body.scheduleDays.map(Number) : null;
        if (!["daily","weekly"].includes(scheduleFrequency) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduleTimeLocal)
          || (scheduleFrequency === "daily" && scheduleDays !== null && scheduleDays.length > 0)
          || (scheduleFrequency === "weekly" && (!scheduleDays || scheduleDays.length < 1 || scheduleDays.length > 7 || scheduleDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7) || new Set(scheduleDays).size !== scheduleDays.length))) throw new Error("INVALID_AUTOMATION_SCHEDULE");
        const { data: next, error: scheduleError } = await ctx.admin.rpc("main_workspace_next_automation_run_at", {
          p_timezone: timezone, p_frequency: scheduleFrequency, p_time: scheduleTimeLocal + ":00", p_days: scheduleDays,
        });
        if (scheduleError || !next) throw new Error("INVALID_AUTOMATION_SCHEDULE");
        nextRunAt = next;
      }

      const { data, error } = await ctx.admin.from("workspace_automation_rules").insert({
        workspace_id: ctx.workspaceId, name, event_type: eventType, trigger_type: triggerType, conditions,
        action_type: "create_task", action_config: { title, description, due_in_hours: dueHours },
        timezone, schedule_frequency: scheduleFrequency, schedule_time_local: scheduleTimeLocal,
        schedule_days_of_week: scheduleDays, next_run_at: nextRunAt, created_by: ctx.user.id,
      }).select("id,name,event_type,trigger_type,conditions,action_type,action_config,timezone,schedule_frequency,schedule_time_local,schedule_days_of_week,next_run_at,is_active,created_at").single();
      if (error || !data) throw new Error("AUTOMATION_CREATE_FAILED");
      await writeAudit(ctx, "automation.rule_created", "automation_rule", data.id, { event_type: eventType, trigger_type: triggerType, action_type: "create_task" });
      return json({ ok: true, rule: data }, 201, origin);
    }
    if (body.action === "automation.preferences.save") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      const timezone = clean(body.timezone || "UTC", 80);
      const quietStart = clean(body.quietHoursStart || "22:00", 5);
      const quietEnd = clean(body.quietHoursEnd || "08:00", 5);
      const remindersEnabled = body.remindersEnabled !== false;
      const escalationEnabled = body.escalationEnabled === true;
      const escalationAfterHours = Number(body.escalationAfterHours ?? 24);
      try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date()); } catch { throw new Error("INVALID_TIMEZONE"); }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(quietStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietEnd)
        || !Number.isInteger(escalationAfterHours) || escalationAfterHours < 1 || escalationAfterHours > 720) {
        throw new Error("INVALID_AUTOMATION_PREFERENCES");
      }
      const { data, error } = await ctx.admin.from("workspace_automation_preferences").upsert({
        workspace_id: ctx.workspaceId, timezone, reminders_enabled: remindersEnabled, quiet_hours_start: quietStart + ":00", quiet_hours_end: quietEnd + ":00",
        escalation_enabled: escalationEnabled, escalation_after_hours: escalationAfterHours,
        created_by: ctx.user.id, updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id" }).select("timezone,reminders_enabled,quiet_hours_start,quiet_hours_end,escalation_enabled,escalation_after_hours,updated_at").single();
      if (error || !data) throw new Error("AUTOMATION_PREFERENCES_SAVE_FAILED");
      await writeAudit(ctx, "automation.preferences_updated", "automation_preferences", ctx.workspaceId, { timezone, escalation_enabled: escalationEnabled });
      return json({ ok: true, preferences: data }, 200, origin);
    }
    if (body.action === "automation.notification.read") {
      if (!canUseVault(ctx.role)) throw new Error("ACCESS_DENIED");
      if (typeof body.notificationId !== "string") throw new Error("INVALID_NOTIFICATION");
      const { data, error } = await ctx.admin.from("workspace_automation_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("workspace_id", ctx.workspaceId).eq("id", body.notificationId)
        .select("id,read_at").maybeSingle();
      if (error || !data) throw new Error("AUTOMATION_NOTIFICATION_NOT_FOUND");
      await writeAudit(ctx, "automation.notification_read", "automation_notification", data.id);
      return json({ ok: true, notification: data }, 200, origin);
    }
    if (body.action === "automation.replay") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      if (typeof body.eventId !== "string") throw new Error("INVALID_AUTOMATION_EVENT");
      const { data, error } = await ctx.admin.from("workspace_event_outbox")
        .update({ processing_status: "pending", attempt_count: 0, next_attempt_at: new Date().toISOString(), processing_error_code: null, processed_at: null })
        .eq("workspace_id", ctx.workspaceId).eq("id", body.eventId).eq("processing_status", "dead_letter")
        .select("id").maybeSingle();
      if (error || !data) throw new Error("AUTOMATION_EVENT_NOT_REPLAYABLE");
      await writeAudit(ctx, "automation.event_replayed", "automation_event", data.id);
      return json({ ok: true, eventId: data.id }, 200, origin);
    }
    if (body.action === "automation.pause") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      if (typeof body.ruleId !== "string" || typeof body.isActive !== "boolean") throw new Error("INVALID_AUTOMATION");
      const { data, error } = await ctx.admin.from("workspace_automation_rules").update({ is_active: body.isActive, updated_at: new Date().toISOString() })
        .eq("workspace_id", ctx.workspaceId).eq("id", body.ruleId).select("id,is_active").maybeSingle();
      if (error || !data) throw new Error("AUTOMATION_RULE_NOT_FOUND");
      await writeAudit(ctx, data.is_active ? "automation.rule_enabled" : "automation.rule_paused", "automation_rule", data.id);
      return json({ ok: true, rule: data }, 200, origin);
    }
    if (body.action === "automation.task_status") {
      if (!canUseVault(ctx.role)) throw new Error("ACCESS_DENIED");
      if (typeof body.taskId !== "string" || !["open","completed","dismissed"].includes(String(body.status))) throw new Error("INVALID_TASK_STATUS");
      const { data, error } = await ctx.admin.from("workspace_automation_tasks").update({
        status: body.status, completed_at: body.status === "completed" ? new Date().toISOString() : null,
      }).eq("workspace_id", ctx.workspaceId).eq("id", body.taskId).select("id,status").maybeSingle();
      if (error || !data) throw new Error("AUTOMATION_TASK_NOT_FOUND");
      await writeAudit(ctx, "automation.task_status_changed", "automation_task", data.id, { status: data.status });
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
