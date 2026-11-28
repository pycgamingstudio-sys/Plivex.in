import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [migration, endpoint] = await Promise.all([
  read("../../../supabase/migrations/20261128095056_document_ocr_worker_lifecycle.sql"),
  read("../../../supabase/functions/workspace-platform/index.ts"),
]);

test("OCR queue migration enforces bounded retries and recovers stale leases", () => {
  assert.match(migration, /attempt_count integer not null default 0/);
  assert.match(migration, /max_attempts integer not null default 3/);
  assert.match(migration, /max_attempts between 1 and 10/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /locked_at < now\(\) - interval '15 minutes'/);
});

test("OCR worker RPCs are service-role-only and validate state transitions", () => {
  for (const fn of ["claim_document_ocr_job", "claim_document_ocr_jobs", "complete_document_ocr_job", "fail_document_ocr_job"]) {
    assert.match(migration, new RegExp("revoke all on function public\\." + fn + "\\("));
    assert.match(migration, new RegExp("grant execute on function public\\." + fn + "\\("));
  }
  assert.equal((migration.match(/auth\.jwt\(\) ->> 'role'/g) || []).length, 4);
  assert.doesNotMatch(migration, /auth\.role\(\)/);
  assert.match(migration, /status = 'processing'/);
  assert.match(migration, /status = 'completed'/);
  assert.match(migration, /status = case when attempt_count >= max_attempts then 'failed' else 'queued' end/);
});

test("OCR upload validates provider configuration before storage and creates a queued job", () => {
  const start = endpoint.indexOf("async function processOcr");
  const end = endpoint.indexOf("async function whatsappSend", start);
  const ocr = endpoint.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(ocr, /if \(!apiKey\) throw new Error\("OCR_PROVIDER_NOT_CONFIGURED"\)/);
  assert.match(ocr, /status: "queued"/);
  assert.match(ocr, /claim_document_ocr_job/);
  assert.match(ocr, /complete_document_ocr_job/);
  assert.match(ocr, /requiresHumanReview: true/);
});

test("OCR provider attempts are bounded, timed out, and failures update the job lifecycle", () => {
  const start = endpoint.indexOf("async function processOcr");
  const end = endpoint.indexOf("async function whatsappSend", start);
  const ocr = endpoint.slice(start, end);
  assert.match(ocr, /attempt < 3/);
  assert.match(ocr, /AbortSignal\.timeout\(45000\)/);
  assert.match(ocr, /fail_document_ocr_job/);
  assert.match(ocr, /OCR_RETRY_CLAIM_FAILED/);
});

test("Main Workspace MCP read tools enforce scopes, workspace isolation and bounded cursor pagination", () => {
  const start = endpoint.indexOf("const mcpLists");
  const end = endpoint.indexOf('if (name === "business_insights")', start);
  const mcp = endpoint.slice(start, end);
  const pageStart = endpoint.indexOf("async function readPublicApiPage");
  const pageEnd = endpoint.indexOf("async function publicApi", pageStart);
  const page = endpoint.slice(pageStart, pageEnd);
  for (const tool of ["list_expenses", "list_leads", "list_low_stock"]) assert.ok(mcp.includes(tool));
  assert.match(mcp, /key\.scopes\.includes\(listTool\.scope\)/);
  assert.match(page, /\.eq\("workspace_id", key\.workspace_id\)/);
  assert.match(page, /parsePublicApiLimit\(body\.limit\)/);
  assert.match(page, /limit \+ 1/);
  assert.match(page, /decodePublicApiCursor\(body\.cursor\)/);
  assert.match(page, /Number\(item\.quantity\) <= Number\(item\.low_stock\)/);
});
