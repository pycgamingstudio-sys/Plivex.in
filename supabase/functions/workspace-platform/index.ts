import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { decodePublicApiCursor, encodePublicApiCursor, normalizePublicApiLead, parsePublicApiLimit, publicApiError } from "../_shared/public-api-contract.ts";

const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const allowed = (origin: string | null) => !origin || ORIGINS.has(origin) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:pages|workers)\.dev$/.test(origin);
const cors = (origin: string | null) => ({ "Access-Control-Allow-Origin": origin && allowed(origin) ? origin : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-plivex-key, x-plivex-api-version, idempotency-key, x-correlation-id, x-hub-signature-256", "Access-Control-Allow-Methods": "POST, OPTIONS" });
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const encoder = new TextEncoder();
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const sha256 = async (value: string | Uint8Array) => {
  const input = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value.byteLength);
  if (typeof value !== "string") input.set(value);
  const digest = await crypto.subtle.digest("SHA-256", input.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
};
const token = (bytes = 32) => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const fromBase64 = (value: string) => {
  const raw = atob(value);
  if (raw.length > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const toBase64 = (bytes: Uint8Array) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

async function setup(req: Request) {
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) throw new Error("SERVICE_NOT_CONFIGURED");
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
  const authClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error || !user) throw new Error("AUTH_REQUIRED");
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin.from("profiles").select("workspace_id,role,country_code").eq("id", user.id).maybeSingle();
  if (profileError || !profile?.workspace_id) throw new Error("WORKSPACE_NOT_FOUND");
  const { data: settings, error: settingsError } = await admin.from("workspace_settings").select("workspace_id,country_code,currency_code,locale_code").eq("workspace_id", profile.workspace_id).maybeSingle();
  if (settingsError || !settings) throw new Error("WORKSPACE_NOT_READY");
  const { data: membership, error: membershipError } = await admin.from("workspace_members").select("role,status").eq("workspace_id", profile.workspace_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (membershipError) throw new Error("WORKSPACE_MEMBERSHIP_CHECK_FAILED");
  if (!membership) throw new Error("WORKSPACE_MEMBERSHIP_REQUIRED");
  const role = String(membership.role || "");
  return { admin, user, workspaceId: String(profile.workspace_id), settings, role };
}
const canManage = (role: string) => ["admin", "manager"].includes(role);
const canSign = (role: string) => ["admin", "manager", "accountant"].includes(role);

async function ensureBucket(admin: any, name: string, mimeTypes: string[]) {
  const { data, error } = await admin.storage.listBuckets();
  if (error) throw new Error("STORAGE_UNAVAILABLE");
  const existing = (data || []).find((b: any) => b.name === name);
  if (existing) { if (existing.public !== false) throw new Error("PRIVATE_BUCKET_REQUIRED"); return; }
  const { error: createError } = await admin.storage.createBucket(name, { public: false, fileSizeLimit: MAX_FILE_BYTES, allowedMimeTypes: mimeTypes });
  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) throw new Error("BUCKET_CREATE_FAILED");
}
async function signatureCreate(ctx: any, body: any) {
  if (!canSign(ctx.role)) throw new Error("ACCESS_DENIED");
  const signerName = clean(body.signerName, 160), signerEmail = clean(body.signerEmail, 254).toLowerCase();
  if (signerName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) throw new Error("INVALID_SIGNER");
  const { data: invoice, error } = await ctx.admin.from("invoices").select("id,number,invoice_snapshot,status,total,currency,issue_date,due_date").eq("workspace_id", ctx.workspaceId).eq("id", body.invoiceId).maybeSingle();
  if (error || !invoice) throw new Error("INVOICE_NOT_FOUND");
  if (["draft", "cancelled", "void"].includes(String(invoice.status).toLowerCase())) throw new Error("INVOICE_NOT_ISSUED");
  const snapshot = { id: invoice.id, number: invoice.number, snapshot: invoice.invoice_snapshot, total: invoice.total, currency: invoice.currency };
  const documentHash = await sha256(JSON.stringify(snapshot));
  const secret = token(), tokenHash = await sha256(secret);
  const days = Math.min(30, Math.max(1, Number(body.expiryDays) || 14));
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const { data, error: insertError } = await ctx.admin.from("document_signing_requests").insert({
    workspace_id: ctx.workspaceId, invoice_id: invoice.id, requested_by: ctx.user.id,
    signer_name: signerName, signer_email: signerEmail, token_hash: tokenHash,
    document_sha256: documentHash, expires_at: expiresAt,
  }).select("id,status,expires_at,created_at").single();
  if (insertError || !data) throw new Error("SIGN_REQUEST_CREATE_FAILED");
  const base = (Deno.env.get("PLIVEX_APP_URL") || "https://plivex.in").replace(/\/$/, "");
  return { ok: true, request: data, signUrl: base + "/sign/" + secret, invoiceNumber: invoice.number,
    note: "This records electronic consent and an audit trail. It is not a qualified eIDAS, Aadhaar eSign, DSC or government-certified signing service." };
}
async function signaturePreview(admin: any, secret: string) {
  if (secret.length < 30) throw new Error("SIGN_REQUEST_NOT_FOUND");
  const { data: record, error } = await admin.from("document_signing_requests").select("id,workspace_id,invoice_id,signer_name,signer_email,status,document_sha256,expires_at").eq("token_hash", await sha256(secret)).maybeSingle();
  if (error || !record) throw new Error("SIGN_REQUEST_NOT_FOUND");
  if (record.status !== "pending" || new Date(record.expires_at).getTime() <= Date.now()) throw new Error("SIGN_REQUEST_NOT_ACTIVE");
  const { data: invoice, error: invoiceError } = await admin.from("invoices").select("number,status,currency,issue_date,due_date,total,invoice_snapshot").eq("workspace_id", record.workspace_id).eq("id", record.invoice_id).maybeSingle();
  if (invoiceError || !invoice) throw new Error("SIGN_DOCUMENT_NOT_FOUND");
  return { ok: true, signerName: record.signer_name, signerEmail: record.signer_email, documentSha256: record.document_sha256, invoice };
}
async function signatureComplete(admin: any, req: Request, body: any) {
  const secret = clean(body.token, 256), name = clean(body.signatureName, 160);
  if (secret.length < 30 || name.length < 2 || body.consent !== true) throw new Error("SIGNATURE_CONSENT_REQUIRED");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const salt = Deno.env.get("SIGNING_AUDIT_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "plivex";
  const ipHash = await sha256(ip + salt);
  const consent = "I agree to sign this document electronically and confirm that the typed name above represents my signature.";
  const ua = clean(req.headers.get("user-agent"), 500);
  const auditHash = await sha256([name, consent, new Date().toISOString(), ipHash, ua].join("|"));
  const { data, error } = await admin.rpc("complete_main_workspace_document_signature", {
    p_token_hash: await sha256(secret), p_signature_name: name, p_consent_text: consent,
    p_ip_hash: ipHash, p_user_agent: ua, p_audit_sha256: auditHash,
  });
  if (error || !data?.ok) throw new Error(data?.code || "SIGNATURE_FAILED");
  return { ok: true, signedAt: data.signed_at, documentSha256: data.document_sha256, auditSha256: data.audit_sha256 };
}
async function processOcr(ctx: any, body: any) {
  if (!["admin", "manager", "accountant", "employee"].includes(ctx.role)) throw new Error("ACCESS_DENIED");
  const mime = clean(body.mimeType, 40);
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)) throw new Error("UNSUPPORTED_FILE_TYPE");
  const bytes = fromBase64(clean(body.fileBase64, 6 * 1024 * 1024));
  if (!bytes.length) throw new Error("EMPTY_FILE");
  const valid = mime === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === "image/png" ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      : mime === "image/webp" ? new TextDecoder().decode(bytes.slice(0,4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8,12)) === "WEBP"
        : new TextDecoder().decode(bytes.slice(0,5)) === "%PDF-";
  if (!valid) throw new Error("FILE_TYPE_MISMATCH");
  const jobId = crypto.randomUUID(), path = ctx.workspaceId + "/" + jobId;
  const docType = ["invoice","receipt","purchase_order","identity","other"].includes(body.documentType) ? body.documentType : "other";
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("OCR_PROVIDER_NOT_CONFIGURED");
  await ensureBucket(ctx.admin, "main-workspace-ocr", ["image/jpeg","image/png","image/webp","application/pdf"]);
  const { error: uploadError } = await ctx.admin.storage.from("main-workspace-ocr").upload(path, new Blob([bytes], { type: mime }), { contentType: mime, upsert: false });
  if (uploadError) throw new Error("OCR_UPLOAD_FAILED");
  const { error: insertError } = await ctx.admin.from("document_ocr_jobs").insert({ id: jobId, workspace_id: ctx.workspaceId, created_by: ctx.user.id, document_type: docType, storage_path: path, mime_type: mime, status: "queued" });
  if (insertError) { await ctx.admin.storage.from("main-workspace-ocr").remove([path]); throw new Error("OCR_JOB_CREATE_FAILED"); }
  const { data: claimed, error: claimError } = await ctx.admin.rpc("claim_document_ocr_job", { p_job_id: jobId });
  if (claimError || claimed?.id !== jobId) {
    await ctx.admin.from("document_ocr_jobs").update({ status: "failed", error_code: "OCR_JOB_CLAIM_FAILED" }).eq("id", jobId).eq("workspace_id", ctx.workspaceId);
    throw new Error("OCR_JOB_CLAIM_FAILED");
  }
  const model = Deno.env.get("GEMINI_OCR_MODEL") || "gemini-3.8-flash";
  const prompt = "Extract this business document as JSON with document_type, supplier_name, supplier_tax_id, document_number, document_date, due_date, currency, subtotal, tax_total, total, line_items (description, quantity, unit_price, tax_rate, line_total), payment_reference, confidence (0..1), review_notes. Use null for unknown values; never invent unreadable values. This is a review-only draft.";
  let extracted: Record<string, unknown> | null = null;
  let lastError = "OCR_PROVIDER_ERROR";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const { data: retryClaim, error: retryClaimError } = await ctx.admin.rpc("claim_document_ocr_job", { p_job_id: jobId });
      if (retryClaimError || retryClaim?.id !== jobId) throw new Error("OCR_RETRY_CLAIM_FAILED");
    }
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: toBase64(bytes) } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error("OCR_PROVIDER_ERROR");
      const payload = await response.json();
      const raw = payload?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("OCR_INVALID_RESPONSE");
      extracted = parsed as Record<string, unknown>;
      break;
    } catch (error) {
      lastError = error instanceof SyntaxError ? "OCR_INVALID_RESPONSE" : error instanceof Error && error.message === "OCR_INVALID_RESPONSE" ? "OCR_INVALID_RESPONSE" : "OCR_PROVIDER_ERROR";
      const { error: failError } = await ctx.admin.rpc("fail_document_ocr_job", { p_job_id: jobId, p_error_code: lastError });
      if (failError) throw new Error("OCR_JOB_FAILURE_UPDATE_FAILED");
      if (attempt === 2) throw new Error(lastError);
    }
  }
  if (!extracted) throw new Error(lastError);
  const { data: completed, error: updateError } = await ctx.admin.rpc("complete_document_ocr_job", { p_job_id: jobId, p_extracted_data: extracted, p_model_name: model });
  if (updateError || completed?.id !== jobId) throw new Error("OCR_SAVE_FAILED");
  return { ok: true, jobId, extracted, requiresHumanReview: true };
}
async function whatsappSend(ctx: any, body: any) {
  if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN"), phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!accessToken || !phoneId) throw new Error("WHATSAPP_PROVIDER_NOT_CONFIGURED");
  const phone = clean(body.recipientPhone, 20);
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || body.consentConfirmed !== true || clean(body.consentStatement,500).length < 10) throw new Error("WHATSAPP_OPT_IN_REQUIRED");
  const type = body.messageType === "text" ? "text" : "template";
  const payload: any = { messaging_product: "whatsapp", recipient_type: "individual", to: phone.replace("+",""), type };
  if (type === "template") {
    const templateName = clean(body.templateName, 120);
    if (!templateName) throw new Error("WHATSAPP_TEMPLATE_REQUIRED");
    payload.template = { name: templateName, language: { code: clean(body.templateLanguage,12) || "en" }, ...(isObject(body.templateComponents) ? { components: body.templateComponents } : {}) };
  } else {
    const startedAt = Date.parse(body.customerInitiatedAt || "");
    if (!Number.isFinite(startedAt) || startedAt > Date.now() || Date.now() - startedAt > 24 * 60 * 60 * 1000) throw new Error("WHATSAPP_24_HOUR_WINDOW_REQUIRED");
    const text = clean(body.message, 4000); if (!text) throw new Error("WHATSAPP_MESSAGE_REQUIRED");
    payload.text = { body: text };
  }
  const version = clean(Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v22.0", 20);
  const response = await fetch("https://graph.facebook.com/" + version + "/" + encodeURIComponent(phoneId) + "/messages", {
    method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  const providerId = result?.messages?.[0]?.id || null;
  const status = response.ok ? "accepted" : "failed";
  const { data, error } = await ctx.admin.from("whatsapp_delivery_logs").insert({
    workspace_id: ctx.workspaceId, created_by: ctx.user.id, recipient_phone: phone, message_type: type,
    template_name: type === "template" ? clean(body.templateName,120) : null, provider_message_id: providerId,
    status, consent_confirmed: true, consent_statement: clean(body.consentStatement,500),
    error_code: response.ok ? null : clean(result?.error?.code || "META_SEND_FAILED",80),
  }).select("id,status,provider_message_id").single();
  if (error) throw new Error("WHATSAPP_LOG_FAILED");
  if (!response.ok) throw new Error("WHATSAPP_SEND_FAILED");
  return { ok: true, message: data };
}
async function apiManagement(ctx: any, body: any) {
  if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
  if (body.action === "api-key.list") {
    const { data, error } = await ctx.admin.from("public_api_keys").select("id,label,key_prefix,scopes,last_used_at,expires_at,revoked_at,created_at").eq("workspace_id",ctx.workspaceId).order("created_at",{ascending:false});
    if (error) throw new Error("API_KEY_LIST_FAILED");
    return { ok:true, keys:data || [] };
  }
  if (body.action === "api-key.revoke") {
    const { data, error } = await ctx.admin.from("public_api_keys").update({ revoked_at:new Date().toISOString() }).eq("workspace_id",ctx.workspaceId).eq("id",body.keyId).is("revoked_at",null).select("id").maybeSingle();
    if (error || !data) throw new Error("API_KEY_REVOKE_FAILED");
    return { ok:true };
  }
  const label = clean(body.label,80);
  const scopeValues: unknown[] = Array.isArray(body.scopes) ? body.scopes as unknown[] : [];
  const scopes: string[] = [...new Set<string>(scopeValues.filter((scope): scope is string => typeof scope === "string"))];
  const allowedScopes = ["workspace.read","invoices.read","clients.read","expenses.read","leads.read","leads.write","inventory.read","suppliers.read","mcp.read"];
  if (label.length < 2 || !scopes.length || scopes.length > 9 || scopes.some((s:string)=>!allowedScopes.includes(s)) || (scopes.includes("mcp.read") && !scopes.includes("workspace.read"))) throw new Error("INVALID_API_KEY");
  const prefix = "plx_" + crypto.randomUUID().replaceAll("-","").slice(0,6); const secret = prefix + "_" + token(32), keyHash = await sha256(secret);
  const days = Math.min(365,Math.max(1,Number(body.expiryDays)||90));
  const { data, error } = await ctx.admin.from("public_api_keys").insert({ workspace_id:ctx.workspaceId,created_by:ctx.user.id,label,key_hash:keyHash,key_prefix:prefix,scopes,expires_at:new Date(Date.now()+days*86400000).toISOString() }).select("id,label,key_prefix,scopes,expires_at,created_at").single();
  if (error || !data) throw new Error("API_KEY_CREATE_FAILED");
  await ctx.admin.from("workspace_audit_events").insert({ workspace_id:ctx.workspaceId,actor_id:ctx.user.id,action:"api_key.created",entity_type:"api_key",entity_id:data.id,metadata:{scopes,expires_at:data.expires_at} });
  return { ok:true,key:data,secret };
}
async function readPublicApiPage(admin: any, key: any, target: any, body: any) {
  const limit = parsePublicApiLimit(body.limit);
  if (limit === null) throw new Error("API_LIMIT_INVALID");
  const cursor = body.cursor ? decodePublicApiCursor(body.cursor) : null;
  if (body.cursor && !cursor) throw new Error("API_CURSOR_INVALID");
  let query = admin.from(target.table).select(target.fields)
    .eq("workspace_id", key.workspace_id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  }
  const { data, error } = await query;
  if (error) throw new Error("API_READ_FAILED");
  const rows = data || [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const records = target.lowStock
    ? page.filter((item: any) => item.low_stock !== null && item.low_stock !== undefined && Number(item.quantity) <= Number(item.low_stock))
    : page;
  const last = page[page.length - 1];
  return {
    ok: true,
    api_version: "v1",
    records,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodePublicApiCursor({ created_at: last.created_at, id: last.id }) : null,
    },
  };
}

async function publicApi(req: Request, admin: any, body: any, internal = false): Promise<any> {
  const secret = clean(req.headers.get("x-plivex-key"),256);
  if (!secret) throw new Error("API_KEY_REQUIRED");
  const requestedVersion = clean(req.headers.get("x-plivex-api-version") || body.apiVersion || "v1", 10);
  if (requestedVersion !== "v1") throw new Error("API_VERSION_UNSUPPORTED");
  const hash = await sha256(secret);
  const { data: key, error: keyError } = await admin.from("public_api_keys").select("id,workspace_id,created_by,scopes,expires_at,revoked_at").eq("key_hash",hash).maybeSingle();
  if (keyError || !key || key.revoked_at || new Date(key.expires_at).getTime() <= Date.now()) throw new Error("API_KEY_INVALID");
  if (!internal) {
    const {data:withinLimit,error:rateError}=await admin.rpc("consume_main_workspace_api_rate_limit",{p_key_hash:hash,p_limit:60,p_window_seconds:60});
    if(rateError||withinLimit!==true) throw new Error("API_RATE_LIMITED");
    await admin.from("public_api_keys").update({last_used_at:new Date().toISOString()}).eq("id",key.id);
  }
  const scope = (s:string) => key.scopes.includes(s);
  const businessInsightScopes = ["invoices.read","expenses.read","leads.read","inventory.read"];
  const canReadBusinessInsights = businessInsightScopes.every((requiredScope) => scope(requiredScope));
  const action = clean(body.action,80);
  if(action.startsWith("mcp.") && (!scope("mcp.read") || !scope("workspace.read"))) throw new Error("API_SCOPE_DENIED");
  if (action === "mcp.initialize") return { jsonrpc:"2.0", id:body.id ?? null, result:{ protocolVersion:"2025-03-26", capabilities:{tools:{}}, serverInfo:{name:"Plivex Main Workspace",version:"1.0.0"} } };
  if (action === "mcp.tools/list") return { jsonrpc:"2.0", id:body.id ?? null, result:{ tools:[
    {name:"workspace_summary",description:"Read aggregate workspace settings and counts",inputSchema:{type:"object",properties:{},additionalProperties:false}},
    ...(key.scopes.includes("invoices.read") ? [{name:"list_invoices",description:"List recent workspace invoices",inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:100},cursor:{type:"string"}},additionalProperties:false}}] : []),
    ...(key.scopes.includes("clients.read") ? [{name:"list_clients",description:"List workspace clients",inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:100}},additionalProperties:false}}] : []),
    ...(key.scopes.includes("expenses.read") ? [{name:"list_expenses",description:"List recent workspace expenses",inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:100}},additionalProperties:false}}] : []),
    ...(key.scopes.includes("leads.read") ? [{name:"list_leads",description:"List workspace CRM leads",inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:100}},additionalProperties:false}}] : []),
    ...(key.scopes.includes("inventory.read") ? [{name:"list_low_stock",description:"List workspace low-stock inventory items",inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:100}},additionalProperties:false}}] : []),
    ...(canReadBusinessInsights ? [{name:"business_insights",description:"Generate aggregate AI business insights without customer PII",inputSchema:{type:"object",properties:{},additionalProperties:false}}] : [])
  ] } };
  if (action === "mcp.tools/call") {
    const name = clean(body.name || body.params?.name,80);
    const args = isObject(body.arguments) ? body.arguments : (isObject(body.params?.arguments) ? body.params.arguments : {});
    if (!key.scopes.includes("mcp.read") || !key.scopes.includes("workspace.read")) throw new Error("API_SCOPE_DENIED");
    if (name === "workspace_summary") return {jsonrpc:"2.0",id:body.id ?? null,result:{content:[{type:"text",text:JSON.stringify(await publicApi(req,admin,{action:"workspace.summary"},true))}]}};
    if (name === "list_invoices") return {jsonrpc:"2.0",id:body.id ?? null,result:{content:[{type:"text",text:JSON.stringify(await publicApi(req,admin,{action:"invoices.list",limit:args.limit,cursor:args.cursor},true))}]}};
    if (name === "list_clients") return {jsonrpc:"2.0",id:body.id ?? null,result:{content:[{type:"text",text:JSON.stringify(await publicApi(req,admin,{action:"clients.list",limit:args.limit,cursor:args.cursor},true))}]}};
    const mcpLists: Record<string,{table:string;scope:string;fields:string;lowStock?:boolean}> = {
      list_expenses: {table:"expenses",scope:"expenses.read",fields:"id,vendor,category,amount,date,currency_code,status,created_at"},
      list_leads: {table:"leads",scope:"leads.read",fields:"id,name,company,stage,value,score,next_follow_up_at,currency_code,created_at"},
      list_low_stock: {table:"stock",scope:"inventory.read",fields:"id,name,sku,quantity,low_stock,unit,warehouse_id,created_at",lowStock:true}
    };
    const listTool = mcpLists[name];
    if (listTool) {
      if (!key.scopes.includes(listTool.scope)) throw new Error("API_SCOPE_DENIED");
      const page = await readPublicApiPage(admin,key,listTool,{limit:args.limit,cursor:args.cursor,lowStock:listTool.lowStock});
      return {jsonrpc:"2.0",id:body.id ?? null,result:{content:[{type:"text",text:JSON.stringify(page)}]}};
    }
    if (name === "business_insights") {
      if (!canReadBusinessInsights) throw new Error("API_SCOPE_DENIED");
      const [{data:inv},{data:exp},{data:leads},{data:stock}] = await Promise.all([
        admin.from("invoices").select("status,total,currency").eq("workspace_id",key.workspace_id).limit(500),
        admin.from("expenses").select("amount,currency_code").eq("workspace_id",key.workspace_id).limit(500),
        admin.from("leads").select("stage,value,currency_code").eq("workspace_id",key.workspace_id).limit(500),
        admin.from("stock").select("quantity,low_stock").eq("workspace_id",key.workspace_id).limit(500)
      ]);
      const sumByCurrency=(rows:any[],amountKey:string,currencyKey:string)=>rows.reduce((out:any,row:any)=>{const code=String(row[currencyKey]||"UNK");out[code]=(out[code]||0)+Number(row[amountKey]||0);return out;},{});
      const openLeads=(leads||[]).filter((x:any)=>!["Won","Lost","won","lost"].includes(String(x.stage)));
      const aggregate = {invoiceCount:inv?.length||0,invoiceTotalsByCurrency:sumByCurrency(inv||[],"total","currency"),expenseCount:exp?.length||0,expenseTotalsByCurrency:sumByCurrency(exp||[],"amount","currency_code"),leadCount:leads?.length||0,openLeadValueByCurrency:sumByCurrency(openLeads,"value","currency_code"),lowStockItems:(stock||[]).filter((x:any)=>Number(x.quantity)<=Number(x.low_stock)).length};
      const keyGemini=Deno.env.get("GEMINI_API_KEY");
      if(!keyGemini) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
      const model=Deno.env.get("GEMINI_BUSINESS_MODEL")||"gemini-3.8-flash";
      const ai=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(keyGemini),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:"You are Plivex AI Business Manager. Analyze only these aggregate metrics; never request or infer customer personal data. Keep different currencies separate. Give concise actionable insights and explicitly label estimates.\n"+JSON.stringify(aggregate)}]}],generationConfig:{temperature:0.2}})});
      if(!ai.ok) throw new Error("AI_PROVIDER_ERROR");
      const aiBody=await ai.json(); const insight=aiBody?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||"").join("")||"No insight returned.";
      return {jsonrpc:"2.0",id:body.id??null,result:{content:[{type:"text",text:insight}],structuredContent:{aggregate}}};
    }
    throw new Error("MCP_TOOL_NOT_FOUND");
  }
  if (action === "leads.create") {
    if (!scope("leads.write")) throw new Error("API_SCOPE_DENIED");
    const normalized = normalizePublicApiLead(body);
    if (!normalized.ok) throw new Error(normalized.code);
    const idempotencyKey = clean(req.headers.get("idempotency-key"), 128);
    if (!idempotencyKey) throw new Error("API_IDEMPOTENCY_KEY_REQUIRED");
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new Error("API_IDEMPOTENCY_KEY_INVALID");
    const candidate = req.headers.get("x-correlation-id") || "";
    const correlationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : crypto.randomUUID();
    const requestHash = await sha256(JSON.stringify(normalized.value));
    const { data, error } = await admin.rpc("main_workspace_api_create_lead", {
      p_api_key_id: key.id,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
      p_correlation_id: correlationId,
      p_name: normalized.value.name,
      p_company: normalized.value.company,
      p_email: normalized.value.email,
      p_phone: normalized.value.phone,
      p_requirement: normalized.value.requirement,
      p_value: normalized.value.value,
    });
    if (error || !data) throw new Error("API_WRITE_FAILED");
    if (data.ok === false) throw new Error(data.error || "API_WRITE_FAILED");
    return { ...data, api_version: "v1" };
  }
  if (action === "workspace.summary" && scope("workspace.read")) {
    const [{data:settings},{count:invoices},{count:clients}] = await Promise.all([
      admin.from("workspace_settings").select("country_code,currency_code,locale_code").eq("workspace_id",key.workspace_id).maybeSingle(),
      admin.from("invoices").select("id",{count:"exact",head:true}).eq("workspace_id",key.workspace_id),
      admin.from("clients").select("id",{count:"exact",head:true}).eq("workspace_id",key.workspace_id),
    ]);
    return {ok:true,api_version:"v1",workspace:settings,metrics:{invoices:invoices||0,clients:clients||0}};
  }
  const listMap: Record<string,{table:string;scope:string;fields:string;lowStock?:boolean}> = {
    "invoices.list":{table:"invoices",scope:"invoices.read",fields:"id,number,client_name,issue_date,due_date,status,total,currency,created_at"},
    "clients.list":{table:"clients",scope:"clients.read",fields:"id,name,company,email,phone,created_at"},
    "expenses.list":{table:"expenses",scope:"expenses.read",fields:"id,vendor,category,amount,date,currency_code,status,created_at"},
    "leads.list":{table:"leads",scope:"leads.read",fields:"id,name,company,stage,value,score,next_follow_up_at,currency_code,created_at"},
    "inventory.low_stock":{table:"stock",scope:"inventory.read",fields:"id,name,sku,quantity,low_stock,unit,warehouse_id,created_at",lowStock:true},
  };
  const target = listMap[action];
  if (!target || !scope(target.scope)) throw new Error("API_SCOPE_DENIED");
  return await readPublicApiPage(admin,key,target,body);
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!allowed(origin)) return json({error:"Origin not allowed"},403,origin);
  if (req.method === "OPTIONS") return new Response("ok",{headers:cors(origin)});
  if (req.method !== "POST") return json({error:"Method not allowed"},405,origin);
  try {
    const body = await req.json().catch(()=>({}));
    if (!isObject(body)) return json({error:"Invalid request"},400,origin);
    if (body.method === "notifications/initialized") return new Response(null,{status:202,headers:cors(origin)});
    if (!body.action && typeof body.method === "string") body.action = body.method === "initialize" ? "mcp.initialize" : body.method === "tools/list" ? "mcp.tools/list" : body.method === "tools/call" ? "mcp.tools/call" : body.method;
    if (body.action === "signature.preview") return json(await signaturePreview(createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),clean(body.token,256)),200,origin);
    if (body.action === "signature.complete") {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      return json(await signatureComplete(admin,req,body),200,origin);
    }
    if (req.headers.get("x-plivex-key") || req.headers.get("x-plivex-api-version")) {
      const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      return json(await publicApi(req,admin,body),200,origin);
    }
    const ctx = await setup(req);
    let result: any;
    if (body.action === "signature.create") result = await signatureCreate(ctx,body);
    else if (body.action === "signature.revoke") {
      if (!canSign(ctx.role)) throw new Error("ACCESS_DENIED");
      const {data,error}=await ctx.admin.from("document_signing_requests").update({status:"revoked",updated_at:new Date().toISOString()}).eq("workspace_id",ctx.workspaceId).eq("id",body.requestId).eq("status","pending").select("id").maybeSingle();
      if(error||!data) throw new Error("SIGN_REQUEST_REVOKE_FAILED");
      await ctx.admin.from("workspace_audit_events").insert({workspace_id:ctx.workspaceId,actor_id:ctx.user.id,action:"document.signing_request_revoked",entity_type:"signature_request",entity_id:data.id,metadata:{}});
      result={ok:true};
    }
    else if (body.action === "ocr.process") result = await processOcr(ctx,body);
    else if (body.action === "whatsapp.send") result = await whatsappSend(ctx,body);
    else if (body.action === "whatsapp.list") {
      if (!canManage(ctx.role)) throw new Error("ACCESS_DENIED");
      const {data,error}=await ctx.admin.from("whatsapp_delivery_logs").select("id,recipient_phone,message_type,template_name,status,error_code,created_at").eq("workspace_id",ctx.workspaceId).order("created_at",{ascending:false}).limit(50);
      if(error) throw new Error("WHATSAPP_LIST_FAILED"); result={ok:true,messages:data||[]};
    } else if (body.action?.startsWith("api-key.")) result = await apiManagement(ctx,body);
    else throw new Error("UNKNOWN_ACTION");
    return json(result,200,origin);
  } catch (error) {
    const code = error instanceof Error ? error.message : "REQUEST_FAILED";
    if (req.headers.get("x-plivex-key") || req.headers.get("x-plivex-api-version")) {
      const candidate = req.headers.get("x-correlation-id") || "";
      const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : crypto.randomUUID();
      const failure = publicApiError(code, requestId);
      return json(failure.body, failure.status, origin);
    }
    const status = code === "AUTH_REQUIRED" ? 401 : code === "ACCESS_DENIED" ? 403
      : code.includes("NOT_FOUND") ? 404 : code.includes("INVALID") || code.includes("REQUIRED") ? 400
      : code.includes("NOT_CONFIGURED") || code.includes("UNAVAILABLE") ? 503 : 500;
    return json({ok:false,error:code},status,origin);
  }
});
