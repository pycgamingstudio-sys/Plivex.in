import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = "global-exports";
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" :
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function toCsv(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return "";
    const keys = [...new Set(data.flatMap((row) => isObject(row) ? Object.keys(row) : ["value"]))];
    return [keys.map(csvCell).join(","), ...data.map((row) =>
      keys.map((key) => csvCell(isObject(row) ? row[key] : row)).join(","))].join("\r\n");
  }
  if (isObject(data)) {
    const rows = Object.entries(data).flatMap(([table, records]) =>
      Array.isArray(records) ? records.map((record) => [table, record]) : [[table, records]]);
    return ["table,record", ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
  }
  return "value\r\n" + csvCell(data);
}
async function ensurePrivateBucket(admin: any) {
  const { data, error } = await admin.storage.listBuckets();
  if (error) throw new Error("STORAGE_UNAVAILABLE");
  const existing = (data || []).find((bucket: any) => bucket.name === BUCKET);
  if (existing) {
    if (existing.public !== false) throw new Error("EXPORT_BUCKET_MUST_BE_PRIVATE");
    return;
  }
  const { error: createError } = await admin.storage.createBucket(BUCKET, {
    public: false, fileSizeLimit: MAX_EXPORT_BYTES,
    allowedMimeTypes: ["application/json", "text/csv"],
  });
  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
    throw new Error("STORAGE_BUCKET_CREATE_FAILED");
  }
}
async function signedUrl(admin: any, path: string) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error("SIGNED_URL_FAILED");
  return data.signedUrl;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);
  const auth = await authenticateGlobal(req);
  if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);

  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 8192) return globalJson({ error: "Request too large" }, 413, origin);
    const body = JSON.parse(raw);
    if (!isObject(body) || !UUID.test(body.workspaceId || "") || !UUID.test(body.jobId || "")
      || !["process", "download"].includes(body.action)) return globalJson({ error: "Invalid request" }, 400, origin);

    const { data: limited, error: limitError } = await auth.admin.rpc("global_consume_enterprise_rate_limit", {
      p_key: auth.user.id + ":export", p_limit: 10, p_window_seconds: 60,
    });
    if (limitError) return globalJson({ error: "Rate limiter unavailable" }, 503, origin);
    if (limited !== true) return globalJson({ error: "Rate limit exceeded" }, 429, origin);

    if (body.action === "download") {
      const { data, error } = await auth.admin.rpc("global_export_download_path", {
        p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_job_id: body.jobId,
      });
      if (error || !data?.ok) return globalJson({ error: data?.code || "EXPORT_NOT_AVAILABLE" }, 404, origin);
      const url = await signedUrl(auth.admin, data.storagePath);
      return globalJson({ ok: true, signedUrl: url, expiresInSeconds: 300 }, 200, origin);
    }

    const { data: claim, error: claimError } = await auth.admin.rpc("global_export_claim", {
      p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_job_id: body.jobId,
    });
    if (claimError || !claim?.ok) return globalJson({ error: claim?.code || "EXPORT_CLAIM_FAILED" }, 409, origin);

    try {
      const { data: result, error: dataError } = await auth.admin.rpc("global_export_dataset", {
        p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_job_id: body.jobId,
      });
      if (dataError || !result?.ok) throw new Error("EXPORT_DATA_FAILED");
      const content = claim.format === "csv" ? toCsv(result.data) : JSON.stringify(result.data, null, 2);
      const bytes = new TextEncoder().encode(content);
      if (bytes.byteLength > MAX_EXPORT_BYTES) throw new Error("EXPORT_TOO_LARGE");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
      const mime = claim.format === "csv" ? "text/csv" : "application/json";
      const path = `${body.workspaceId}/${body.jobId}.${claim.format}`;
      await ensurePrivateBucket(auth.admin);
      const { error: uploadError } = await auth.admin.storage.from(BUCKET).upload(path, new Blob([bytes], { type: mime }), {
        contentType: mime, upsert: false,
      });
      if (uploadError) throw new Error("EXPORT_UPLOAD_FAILED");
      const { data: completed, error: completeError } = await auth.admin.rpc("global_export_complete", {
        p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_job_id: body.jobId,
        p_storage_path: path, p_sha256: hash,
      });
      if (completeError || !completed?.ok) {
        await auth.admin.storage.from(BUCKET).remove([path]);
        throw new Error("EXPORT_FINALIZE_FAILED");
      }
      const url = await signedUrl(auth.admin, path);
      return globalJson({ ok: true, jobId: body.jobId, sha256: hash, signedUrl: url, expiresInSeconds: 300 }, 200, origin);
    } catch (error) {
      await auth.admin.rpc("global_export_fail", {
        p_user_id: auth.user.id, p_workspace_id: body.workspaceId, p_job_id: body.jobId,
        p_error_code: error instanceof Error ? error.message : "EXPORT_FAILED",
      });
      throw error;
    }
  } catch {
    return globalJson({ error: "Export operation failed" }, 500, origin);
  }
});
