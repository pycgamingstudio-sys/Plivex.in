import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^[a-f0-9]{64}$/;
const SIGN_BUCKET = "global-signing-documents";
const OCR_BUCKET = "global-ocr-documents";
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: { ...globalCorsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const sha256 = async (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
};
const randomToken = (bytes = 32) => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return btoa(binary);
};
const bytesFromBase64 = (value: string) => {
  const raw = atob(value);
  if (raw.length > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

async function member(admin: any, userId: string, workspaceId: string, roles?: string[]) {
  const { data, error } = await admin.schema("global").from("workspace_members")
    .select("id,role,status").eq("workspace_id", workspaceId).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (error || !data || (roles && !roles.includes(data.role))) return null;
  return data;
}
async function ensureBucket(admin: any, name: string, mime: string[]) {
  const { data, error } = await admin.storage.listBuckets();
  if (error) throw new Error("STORAGE_UNAVAILABLE");
  const found = (data || []).find((item: any) => item.name === name);
  if (found) {
    if (found.public !== false) throw new Error("PRIVATE_BUCKET_REQUIRED");
    return;
  }
  const { error: createError } = await admin.storage.createBucket(name, { public: false, fileSizeLimit: MAX_FILE_BYTES, allowedMimeTypes: mime });
  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) throw new Error("BUCKET_CREATE_FAILED");
}
async function createSignature(admin: any, user: any, body: any) {
  if (!UUID.test(body.workspaceId || "") || !UUID.test(body.invoiceId || "")) throw new Error("INVALID_REQUEST");
  const membership = await member(admin, user.id, body.workspaceId, ["owner", "admin", "manager", "accountant"]);
  if (!membership) throw new Error("ACCESS_DENIED");
  const signerName = clean(body.signerName, 160);
  const signerEmail = clean(body.signerEmail, 254).toLowerCase();
  if (signerName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) throw new Error("INVALID_SIGNER");
  const { data: invoice, error } = await admin.schema("global").from("invoices")
    .select("id,invoice_number,invoice_snapshot,status,total_minor,currency_code")
    .eq("workspace_id", body.workspaceId).eq("id", body.invoiceId).maybeSingle();
  if (error || !invoice) throw new Error("INVOICE_NOT_FOUND");
  if (["draft", "cancelled", "void"].includes(String(invoice.status).toLowerCase())) throw new Error("INVOICE_NOT_ISSUED");
  const documentSha = await sha256(JSON.stringify({ id: invoice.id, number: invoice.invoice_number, snapshot: invoice.invoice_snapshot, total: invoice.total_minor, currency: invoice.currency_code }));
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + Math.min(30, Math.max(1, Number(body.expiryDays) || 14)) * 86400000).toISOString();
  const { data, error: insertError } = await admin.schema("global").from("document_signing_requests").insert({
    workspace_id: body.workspaceId, invoice_id: invoice.id, requested_by: user.id,
    signer_name: signerName, signer_email: signerEmail, token_hash: tokenHash,
    document_sha256: documentSha, expires_at: expiresAt,
  }).select("id,status,expires_at,created_at").single();
  if (insertError || !data) throw new Error("SIGN_REQUEST_CREATE_FAILED");
  const base = Deno.env.get("PLIVEX_APP_URL") || "https://plivex.in";
  const signUrl = base.replace(/\/$/, "") + "/sign/" + token;
  return { ok: true, request: data, signUrl, invoiceNumber: invoice.invoice_number, note: "Copy and send this link to the named signer. This records an electronic-signature consent and audit trail; it is not a qualified or government-certified digital signature." };
}
async function signPreview(admin: any, token: string) {
  if (token.length < 30) throw new Error("SIGN_REQUEST_NOT_FOUND");
  const tokenHash = await sha256(token);
  const { data: record, error } = await admin.schema("global").from("document_signing_requests")
    .select("id,invoice_id,signer_name,signer_email,status,document_sha256,expires_at")
    .eq("token_hash", tokenHash).maybeSingle();
  if (error || !record) throw new Error("SIGN_REQUEST_NOT_FOUND");
  if (record.status !== "pending" || new Date(record.expires_at).getTime() <= Date.now()) throw new Error("SIGN_REQUEST_NOT_ACTIVE");
  const { data: invoice, error: invoiceError } = await admin.schema("global").from("invoices")
    .select("invoice_number,status,currency_code,issue_date,due_date,subtotal_minor,tax_minor,total_minor,invoice_snapshot")
    .eq("id", record.invoice_id).maybeSingle();
  if (invoiceError || !invoice) throw new Error("SIGN_DOCUMENT_NOT_FOUND");
  return { ok: true, signerName: record.signer_name, signerEmail: record.signer_email, documentSha256: record.document_sha256, invoice };
}
async function signDocument(admin: any, req: Request, body: any) {
  const token = clean(body.token, 256);
  const signatureName = clean(body.signatureName, 160);
  if (token.length < 30 || signatureName.length < 2 || body.consent !== true) throw new Error("SIGNATURE_CONSENT_REQUIRED");
  const tokenHash = await sha256(token);
  const { data: record, error } = await admin.schema("global").from("document_signing_requests")
    .select("id,workspace_id,signer_name,signer_email,status,document_sha256,expires_at")
    .eq("token_hash", tokenHash).maybeSingle();
  if (error || !record) throw new Error("SIGN_REQUEST_NOT_FOUND");
  if (record.status !== "pending" || new Date(record.expires_at).getTime() <= Date.now()) throw new Error("SIGN_REQUEST_NOT_ACTIVE");
  if (signatureName.toLowerCase() !== String(record.signer_name).toLowerCase()) throw new Error("SIGNER_NAME_MISMATCH");
  const consentText = "I agree to sign this document electronically and confirm that the typed name above represents my signature.";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipHash = await sha256(ip + (Deno.env.get("SIGNING_AUDIT_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "plivex-signing-audit"));
  const userAgent = clean(req.headers.get("user-agent"), 500);
  const signedAt = new Date().toISOString();
  const auditHash = await sha256([record.id, record.document_sha256, signatureName, record.signer_email, consentText, signedAt, ipHash, userAgent].join("|"));
  const { data, error: rpcError } = await admin.rpc("global_complete_document_signature", {
    p_token_hash: tokenHash, p_signature_name: signatureName, p_consent_text: consentText,
    p_ip_hash: ipHash, p_user_agent: userAgent, p_signed_at: signedAt, p_audit_sha256: auditHash,
  });
  if (rpcError || !data?.ok) throw new Error(data?.code || "SIGN_REQUEST_ALREADY_USED");
  return { ok: true, signedAt: data.signed_at, documentSha256: data.document_sha256, auditSha256: data.audit_sha256 };
}
async function processOcr(admin: any, user: any, body: any) {
  if (!UUID.test(body.workspaceId || "")) throw new Error("INVALID_REQUEST");
  if (!await member(admin, user.id, body.workspaceId, ["owner", "admin", "manager", "accountant", "employee"])) throw new Error("ACCESS_DENIED");
  const mime = clean(body.mimeType, 40);
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)) throw new Error("UNSUPPORTED_FILE_TYPE");
  const bytes = bytesFromBase64(clean(body.fileBase64, 12 * 1024 * 1024));
  if (!bytes.length) throw new Error("EMPTY_FILE");
  const validMagic = mime === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === "image/png" ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      : mime === "image/webp" ? new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
        : new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (!validMagic) throw new Error("FILE_TYPE_MISMATCH");
  const type = ["invoice", "receipt", "purchase_order", "identity", "other"].includes(body.documentType) ? body.documentType : "other";
  const jobId = crypto.randomUUID();
  await ensureBucket(admin, OCR_BUCKET, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  const path = body.workspaceId + "/" + jobId;
  const { error: uploadError } = await admin.storage.from(OCR_BUCKET).upload(path, new Blob([bytes], { type: mime }), { contentType: mime, upsert: false });
  if (uploadError) throw new Error("OCR_UPLOAD_FAILED");
  const { error: insertError } = await admin.schema("global").from("document_ocr_jobs").insert({
    id: jobId, workspace_id: body.workspaceId, created_by: user.id, document_type: type,
    storage_path: path, mime_type: mime, status: "processing",
  });
  if (insertError) { await admin.storage.from(OCR_BUCKET).remove([path]); throw new Error("OCR_JOB_CREATE_FAILED"); }
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) { await admin.schema("global").from("document_ocr_jobs").update({ status: "failed", error_code: "OCR_PROVIDER_NOT_CONFIGURED" }).eq("id", jobId); throw new Error("OCR_PROVIDER_NOT_CONFIGURED"); }
  const model = Deno.env.get("GEMINI_OCR_MODEL") || "gemini-2.5-flash";
  const prompt = "Extract the document into JSON. Return only JSON with keys document_type, supplier_name, supplier_tax_id, document_number, document_date, due_date, currency, subtotal, tax_total, total, line_items (array of description, quantity, unit_price, tax_rate, line_total), payment_reference, confidence (0..1), and review_notes (array). Use null for unknown values. Never invent unreadable values. This is an extraction draft; it must be reviewed by a human before use.";
  const base64 = toBase64(bytes);
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }),
  });
  if (!response.ok) {
    await admin.schema("global").from("document_ocr_jobs").update({ status: "failed", error_code: "OCR_PROVIDER_ERROR" }).eq("id", jobId);
    throw new Error("OCR_PROVIDER_ERROR");
  }
  const payload = await response.json();
  const output = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("") || "";
  let extracted: any;
  try { extracted = JSON.parse(output); if (!isObject(extracted)) throw new Error("INVALID_EXTRACTION"); } catch { extracted = { raw_text: output.slice(0, 12000), review_notes: ["Provider response was not valid structured JSON; manual review required."] }; }
  const { error: updateError } = await admin.schema("global").from("document_ocr_jobs").update({
    status: "completed", extracted_data: extracted, model_name: model, completed_at: new Date().toISOString(),
  }).eq("id", jobId);
  if (updateError) throw new Error("OCR_RESULT_SAVE_FAILED");
  return { ok: true, jobId, extracted, requiresHumanReview: true };
}
async function sendWhatsApp(admin: any, user: any, body: any) {
  if (!UUID.test(body.workspaceId || "") || body.consentConfirmed !== true || clean(body.consentStatement, 500).length < 10) throw new Error("WHATSAPP_OPT_IN_REQUIRED");
  if (!await member(admin, user.id, body.workspaceId, ["owner", "admin", "manager", "accountant", "employee"])) throw new Error("ACCESS_DENIED");
  const phone = clean(body.recipientPhone, 20).replace(/[\s()-]/g, "");
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new Error("INVALID_RECIPIENT");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!accessToken || !phoneNumberId) throw new Error("WHATSAPP_PROVIDER_NOT_CONFIGURED");
  const type = body.messageType === "template" ? "template" : "text";
  const payload: any = { messaging_product: "whatsapp", recipient_type: "individual", to: phone, type };
  if (type === "text") {
    const initiatedAt = new Date(body.customerInitiatedAt || 0).getTime();
    if (!Number.isFinite(initiatedAt) || Date.now() - initiatedAt > 24 * 60 * 60 * 1000 || initiatedAt > Date.now() + 60000) throw new Error("WHATSAPP_24_HOUR_WINDOW_REQUIRED");
    const message = clean(body.message, 4000);
    if (!message) throw new Error("MESSAGE_REQUIRED");
    payload.text = { preview_url: false, body: message };
  } else {
    const name = clean(body.templateName, 100);
    const language = clean(body.templateLanguage || "en", 10);
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error("INVALID_TEMPLATE");
    payload.template = { name, language: { code: language }, ...(Array.isArray(body.templateComponents) ? { components: body.templateComponents.slice(0, 5) } : {}) };
  }
  const version = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v22.0";
  const response = await fetch("https://graph.facebook.com/" + version + "/" + phoneNumberId + "/messages", {
    method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  const providerId = result?.messages?.[0]?.id || null;
  const status = response.ok && providerId ? "accepted" : "failed";
  await admin.schema("global").from("whatsapp_delivery_logs").insert({
    workspace_id: body.workspaceId, created_by: user.id, recipient_phone: phone,
    message_type: type, template_name: type === "template" ? payload.template.name : null,
    provider_message_id: providerId, status, consent_confirmed: true,
    consent_statement: clean(body.consentStatement, 500),
    error_code: status === "failed" ? "META_SEND_FAILED" : null,
  });
  if (status === "failed") throw new Error("WHATSAPP_SEND_FAILED");
  return { ok: true, providerMessageId: providerId, status: "accepted" };
}

async function publicApi(req: Request, admin: any) {
  const key = req.headers.get("x-plivex-key") || "";
  if (!/^plx_[A-Za-z0-9]{6}_[A-Za-z0-9_-]{30,}$/.test(key)) return json({ error: "API key required" }, 401);
  const keyHash = await sha256(key);
  const { data: apiKey, error } = await admin.schema("global").from("public_api_keys")
    .select("id,workspace_id,created_by,scopes,expires_at,revoked_at").eq("key_hash", keyHash).maybeSingle();
  if (error || !apiKey || apiKey.revoked_at || new Date(apiKey.expires_at).getTime() <= Date.now()) return json({ error: "API key invalid or expired" }, 401);
  const activeOwner = await member(admin, apiKey.created_by, apiKey.workspace_id, ["owner", "admin"]);
  if (!activeOwner) return json({ error: "API key owner is no longer an active workspace administrator" }, 401);
  const { data: limited, error: rateError } = await admin.rpc("global_consume_enterprise_rate_limit", { p_key: "public-api:" + keyHash, p_limit: 120, p_window_seconds: 60 });
  if (rateError || limited !== true) return json({ error: "API rate limit exceeded" }, 429);
  let raw: any;
  if (req.method === "GET") raw = Object.fromEntries(new URL(req.url).searchParams.entries());
  else {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) return json({ error: "API request too large" }, 413);
    try { raw = JSON.parse(rawBody); } catch { raw = {}; }
  }
  if (!isObject(raw)) return json({ error: "Invalid API request body" }, 400);
  const mcpMethod = clean(raw.method, 80);
  const operation = clean(raw.operation || (mcpMethod === "tools/call" ? raw.params?.name : mcpMethod), 80);
  const has = (scope: string) => apiKey.scopes.includes(scope);
  let result: any;
  if (mcpMethod === "notifications/initialized") return new Response(null, { status: 202 });
  if (mcpMethod === "ping") result = {};
  else if (mcpMethod === "initialize") {
    if (!has("mcp.read")) return json({ error: "Scope required: mcp.read" }, 403);
    result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "plivex-global-business", version: "1.0.0" } };
  } else if (operation === "mcp.tools/list" || raw.method === "tools/list") {
    if (!has("mcp.read")) return json({ error: "Scope required: mcp.read" }, 403);
    result = { tools: [
      { name: "workspace_summary", description: "Read aggregate invoice, expense, lead, inventory and supplier totals.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
      { name: "list_invoices", description: "List recent invoices.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
      { name: "list_clients", description: "List workspace clients.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
      { name: "list_expenses", description: "List workspace expenses.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
      { name: "list_leads", description: "List CRM leads and pipeline stages.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
      { name: "low_stock_items", description: "Find stock items at or below their reorder level.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
      { name: "list_suppliers", description: "List workspace suppliers.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
      { name: "business_insights", description: "Generate AI analysis from aggregate financial, sales pipeline and inventory metrics.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    ] };
  } else {
    const args = isObject(raw.arguments) ? raw.arguments : isObject(raw.params?.arguments) ? raw.params.arguments : {};
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 50));
    if (operation === "workspace.summary" || operation === "workspace_summary") {
      if (!has("workspace.read")) return json({ error: "Scope required: workspace.read" }, 403);
      const [invoices, clients, expenses, leads, products, stock, suppliers] = await Promise.all([
        admin.schema("global").from("invoices").select("total_minor,amount_paid_minor,currency_code").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("clients").select("id").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("expenses").select("amount_minor,currency_code").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("crm_leads").select("estimated_value_minor,currency_code,stage").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("products").select("id,is_active").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("stock_levels").select("quantity,reorder_level").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("suppliers").select("id").eq("workspace_id", apiKey.workspace_id).limit(5000),
      ]);
      if ([invoices, clients, expenses, leads, products, stock, suppliers].some((item: any) => item.error)) return json({ error: "Workspace data unavailable" }, 503);
      const totalByCurrency = (rows: any[], amountField: string) => Object.values(rows.reduce((acc: any, row: any) => {
        const currency = row.currency_code || "UNK";
        acc[currency] ||= { currency, totalMinor: 0, count: 0 };
        acc[currency].totalMinor += Number(row[amountField] || 0);
        acc[currency].count += 1;
        return acc;
      }, {}));
      result = {
        invoiceCount: invoices.data.length,
        invoiceTotalsByCurrency: totalByCurrency(invoices.data, "total_minor"),
        expenseTotalsByCurrency: totalByCurrency(expenses.data, "amount_minor"),
        leadPipelineByCurrency: totalByCurrency(leads.data, "estimated_value_minor"),
        clientCount: clients.data.length,
        leadCount: leads.data.length,
        productCount: products.data.length,
        activeProductCount: products.data.filter((item: any) => item.is_active).length,
        lowStockCount: stock.data.filter((item: any) => Number(item.quantity) <= Number(item.reorder_level)).length,
        supplierCount: suppliers.data.length,
      };
    } else if (operation === "invoices.list" || operation === "list_invoices") {
      if (!has("invoices.read")) return json({ error: "Scope required: invoices.read" }, 403);
      const { data, error: readError } = await admin.schema("global").from("invoices").select("id,invoice_number,status,currency_code,issue_date,due_date,total_minor,amount_paid_minor").eq("workspace_id", apiKey.workspace_id).order("created_at", { ascending: false }).limit(limit);
      if (readError) return json({ error: "Invoices unavailable" }, 503);
      result = { invoices: data };
    } else if (operation === "clients.list" || operation === "list_clients") {
      if (!has("clients.read")) return json({ error: "Scope required: clients.read" }, 403);
      const { data, error: readError } = await admin.schema("global").from("clients").select("id,name,email,phone,status").eq("workspace_id", apiKey.workspace_id).order("created_at", { ascending: false }).limit(limit);
      if (readError) return json({ error: "Clients unavailable" }, 503);
      result = { clients: data };
    } else if (operation === "expenses.list" || operation === "list_expenses") {
      if (!has("expenses.read")) return json({ error: "Scope required: expenses.read" }, 403);
      const { data, error: readError } = await admin.schema("global").from("expenses").select("id,category,vendor,amount_minor,currency_code,expense_date,payment_method").eq("workspace_id", apiKey.workspace_id).order("expense_date", { ascending: false }).limit(limit);
      if (readError) return json({ error: "Expenses unavailable" }, 503);
      result = { expenses: data };
    } else if (operation === "leads.list" || operation === "list_leads") {
      if (!has("leads.read")) return json({ error: "Scope required: leads.read" }, 403);
      const { data, error: readError } = await admin.schema("global").from("crm_leads").select("id,name,company,estimated_value_minor,currency_code,stage,score,next_follow_up_at").eq("workspace_id", apiKey.workspace_id).order("created_at", { ascending: false }).limit(limit);
      if (readError) return json({ error: "Leads unavailable" }, 503);
      result = { leads: data };
    } else if (operation === "inventory.low_stock" || operation === "low_stock_items") {
      if (!has("inventory.read")) return json({ error: "Scope required: inventory.read" }, 403);
      const { data, error: readError } = await admin.schema("global").from("stock_levels").select("product_id,quantity,reorder_level").eq("workspace_id", apiKey.workspace_id).order("updated_at", { ascending: false }).limit(5000);
      if (readError) return json({ error: "Inventory unavailable" }, 503);
      const low = (data || []).filter((item: any) => Number(item.quantity) <= Number(item.reorder_level)).slice(0, limit);
      result = { lowStockItems: low };
    } else if (operation === "suppliers.list" || operation === "list_suppliers") {
      if (!has("suppliers.read")) return json({ error: "Scope required: suppliers.read" }, 403);
      const { data, error: readError } = await admin.schema("global").from("suppliers").select("id,name,email,phone,tax_registration_number").eq("workspace_id", apiKey.workspace_id).order("created_at", { ascending: false }).limit(limit);
      if (readError) return json({ error: "Suppliers unavailable" }, 503);
      result = { suppliers: data };
    } else if (operation === "business_insights") {
      if (!has("mcp.read") || !has("workspace.read")) return json({ error: "Scopes required: mcp.read and workspace.read" }, 403);
      const [invoices, expenses, leads, stock, products, suppliers] = await Promise.all([
        admin.schema("global").from("invoices").select("currency_code,total_minor,amount_paid_minor").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("expenses").select("currency_code,amount_minor").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("crm_leads").select("currency_code,estimated_value_minor,stage").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("stock_levels").select("quantity,reorder_level").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("products").select("id,is_active").eq("workspace_id", apiKey.workspace_id).limit(5000),
        admin.schema("global").from("suppliers").select("id").eq("workspace_id", apiKey.workspace_id).limit(5000),
      ]);
      if ([invoices, expenses, leads, stock, products, suppliers].some((item: any) => item.error)) return json({ error: "Workspace metrics unavailable" }, 503);
      const group = (rows: any[], field: string) => Object.values(rows.reduce((acc: any, row: any) => {
        const currency = row.currency_code || "UNK";
        acc[currency] ||= { currency, totalMinor: 0, count: 0 };
        acc[currency].totalMinor += Number(row[field] || 0);
        acc[currency].count += 1;
        return acc;
      }, {}));
      const metrics = {
        invoices: group(invoices.data, "total_minor"),
        expenses: group(expenses.data, "amount_minor"),
        leads: group(leads.data, "estimated_value_minor"),
        leadStages: leads.data.reduce((acc: any, row: any) => { const stage = String(row.stage || "unknown"); acc[stage] = (acc[stage] || 0) + 1; return acc; }, {}),
        lowStockCount: stock.data.filter((row: any) => Number(row.quantity) <= Number(row.reorder_level)).length,
        activeProducts: products.data.filter((row: any) => row.is_active).length,
        supplierCount: suppliers.data.length,
      };
      const apiKeyGemini = Deno.env.get("GEMINI_API_KEY");
      if (!apiKeyGemini) return json({ error: "AI provider is not configured" }, 503);
      const model = Deno.env.get("GEMINI_BUSINESS_MODEL") || "gemini-2.5-flash";
      const aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKeyGemini },
        body: JSON.stringify({ contents: [{ parts: [{ text: "You are Plivex AI Business Manager. Analyze only these aggregate multi-module metrics. Identify cash collection and expense observations, CRM pipeline follow-up priorities, and inventory reorder risks. Do not invent trends, causes or amounts; currencies are separate and must never be added together. Clearly label facts versus suggestions and state when data is insufficient. Metrics: " + JSON.stringify(metrics) }] }], generationConfig: { temperature: 0.2 } }),
      });
      if (!aiResponse.ok) return json({ error: "AI insights provider unavailable" }, 503);
      const aiPayload = await aiResponse.json();
      result = { metrics, insights: aiPayload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("") || "No insight generated." };
    } else {
      return json({ error: "Unsupported operation" }, 400);
    }
  }
  await admin.schema("global").from("public_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id);
  if (raw.jsonrpc === "2.0") return json({ jsonrpc: "2.0", id: raw.id ?? null, result: ["initialize", "mcp.tools/list", "tools/list", "ping"].includes(mcpMethod) ? result : { content: [{ type: "text", text: JSON.stringify(result) }], isError: false } });
  return json({ ok: true, data: result });
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  const auth = await authenticateGlobal(req);
  const admin = "error" in auth ? (await import("../_shared/global.ts")).createGlobalAdminClient() : auth.admin;
  try {
    if (req.headers.has("x-plivex-key")) return await publicApi(req, admin);
    if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
    if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 6 * 1024 * 1024) return globalJson({ error: "Request too large" }, 413, origin);
    let body: any;
    try { body = JSON.parse(rawBody); } catch { return globalJson({ error: "Invalid JSON request" }, 400, origin); }
    if (isObject(body) && body.action === "signature.complete") return globalJson(await signDocument(admin, req, body), 200, origin);
    if (isObject(body) && body.action === "signature.preview") return globalJson(await signPreview(admin, clean(body.token, 256)), 200, origin);
    if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);
    if (!isObject(body) || !["signature.request", "signature.list", "ocr.process", "whatsapp.send", "whatsapp.list", "api-key.create", "api-key.list", "api-key.revoke"].includes(body.action)) return globalJson({ error: "Invalid action" }, 400, origin);
    const user = auth.user;
    const { data: userLimit, error: userLimitError } = await admin.rpc("global_consume_enterprise_rate_limit", { p_key: user.id + ":platform", p_limit: 30, p_window_seconds: 60 });
    if (userLimitError || userLimit !== true) return globalJson({ error: "Platform rate limit exceeded" }, 429, origin);
    if (body.action === "signature.request") return globalJson(await createSignature(admin, user, body), 201, origin);
    if (body.action === "signature.list") {
      if (!UUID.test(body.workspaceId || "") || !await member(admin, user.id, body.workspaceId, ["owner", "admin", "manager", "accountant"])) throw new Error("ACCESS_DENIED");
      const { data, error } = await admin.schema("global").from("document_signing_requests").select("id,invoice_id,signer_name,signer_email,status,document_sha256,expires_at,signed_at,created_at").eq("workspace_id", body.workspaceId).order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error("SIGNATURE_LIST_FAILED");
      return globalJson({ ok: true, requests: data }, 200, origin);
    }
    if (body.action === "ocr.process") return globalJson(await processOcr(admin, user, body), 200, origin);
    if (body.action === "whatsapp.send") return globalJson(await sendWhatsApp(admin, user, body), 200, origin);
    if (body.action === "whatsapp.list") {
      if (!UUID.test(body.workspaceId || "") || !await member(admin, user.id, body.workspaceId, ["owner", "admin", "manager", "accountant"])) throw new Error("ACCESS_DENIED");
      const { data, error } = await admin.schema("global").from("whatsapp_delivery_logs")
        .select("id,recipient_phone,message_type,template_name,status,error_code,created_at,provider_message_id")
        .eq("workspace_id", body.workspaceId).order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error("WHATSAPP_LOG_LIST_FAILED");
      return globalJson({ ok: true, messages: data }, 200, origin);
    }
    if (body.action === "api-key.create") {
      if (!UUID.test(body.workspaceId || "") || !await member(admin, user.id, body.workspaceId, ["owner", "admin"])) throw new Error("ACCESS_DENIED");
      const label = clean(body.label, 80);
      const scopes = Array.isArray(body.scopes) ? [...new Set(body.scopes.filter((s: string) => ["workspace.read", "invoices.read", "clients.read", "expenses.read", "leads.read", "inventory.read", "suppliers.read", "mcp.read"].includes(s)))] : ["workspace.read"];
      if (label.length < 2 || !scopes.length) throw new Error("INVALID_API_KEY");
      const prefix = randomToken(16).replace(/[^A-Za-z0-9]/g, "").slice(0, 6);\n      if (prefix.length !== 6) throw new Error("API_KEY_GENERATION_FAILED");\n      const token = "plx_" + prefix + "_" + randomToken(32);
      const expiresAt = new Date(Date.now() + Math.min(365, Math.max(1, Number(body.expiryDays) || 90)) * 86400000).toISOString();
      const { data, error } = await admin.schema("global").from("public_api_keys").insert({
        workspace_id: body.workspaceId, created_by: user.id, label, key_hash: await sha256(token),
        key_prefix: token.slice(0, 10), scopes, expires_at: expiresAt,
      }).select("id,label,key_prefix,scopes,expires_at,created_at").single();
      if (error) throw new Error("API_KEY_CREATE_FAILED");
      return globalJson({ ok: true, apiKey: data, secret: token, warning: "Copy this key now. It will not be shown again." }, 201, origin);
    }
    if (body.action === "api-key.list") {
      if (!UUID.test(body.workspaceId || "") || !await member(admin, user.id, body.workspaceId, ["owner", "admin"])) throw new Error("ACCESS_DENIED");
      const { data, error } = await admin.schema("global").from("public_api_keys").select("id,label,key_prefix,scopes,last_used_at,expires_at,revoked_at,created_at").eq("workspace_id", body.workspaceId).order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error("API_KEY_LIST_FAILED");
      return globalJson({ ok: true, keys: data }, 200, origin);
    }
    if (body.action === "api-key.revoke") {
      if (!UUID.test(body.workspaceId || "") || !UUID.test(body.keyId || "") || !await member(admin, user.id, body.workspaceId, ["owner", "admin"])) throw new Error("ACCESS_DENIED");
      const { data, error } = await admin.schema("global").from("public_api_keys").update({ revoked_at: new Date().toISOString() }).eq("workspace_id", body.workspaceId).eq("id", body.keyId).is("revoked_at", null).select("id").maybeSingle();
      if (error || !data) throw new Error("API_KEY_NOT_FOUND");
      return globalJson({ ok: true, revoked: true }, 200, origin);
    }
    return globalJson({ error: "Unsupported action" }, 400, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PLATFORM_OPERATION_FAILED";
    const status = message === "ACCESS_DENIED" ? 403 : message.includes("NOT_FOUND") ? 404 : message.includes("REQUIRED") || message.startsWith("INVALID") || message.startsWith("UNSUPPORTED") ? 400 : 500;
    return globalJson({ error: message }, status, origin);
  }
});
