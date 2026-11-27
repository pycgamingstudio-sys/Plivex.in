import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, "../../../supabase/migrations/20261127064000_bind_main_workspace_journal_idempotency_payload.sql"),
  "utf8",
);

test("main-workspace journal idempotency binds a key to its payload", () => {
  assert.match(migration, /add column if not exists request_fingerprint text/i);
  assert.match(migration, /jsonb_array_elements\(p_lines\) as line\(value\)/i);
  assert.match(migration, /line\.value->>'account_id'/i);
  assert.match(migration, /order by \(line\.value->>'account_id'\)::uuid/i);
  assert.match(migration, /update public\.journal_entries j[\s\S]*?where j\.request_fingerprint is null/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(/i);
  assert.match(migration, /request_fingerprint is distinct from v_fingerprint/i);
  assert.match(migration, /'idempotency_conflict'/);
  assert.match(migration, /idempotency_key,request_fingerprint,created_by/i);
});

test("legacy idempotency rows without a fingerprint fail closed", () => {
  assert.match(migration, /request_fingerprint is distinct from v_fingerprint/i);
  assert.match(migration, /if found then[\s\S]*?return jsonb_build_object\('ok',false,'reason','idempotency_conflict'\)/i);
});
