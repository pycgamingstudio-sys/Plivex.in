import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261128130000_stage2_bank_statement_import_traceability.sql", import.meta.url), "utf8");

test("bank statement imports retain original row provenance", () => {
  assert.match(migration, /add column if not exists source_row integer/);
  assert.match(migration, /add column if not exists raw_row jsonb/);
  assert.match(migration, /source_row,\s*raw_row/);
  assert.match(migration, /v_row->'rawRow'/);
});

test("bank statement import idempotency is serialized and payload-bound", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /request_fingerprint/);
  assert.match(migration, /idempotency_conflict/);
});

test("bank statement RPC enforces workspace roles and statement date bounds", () => {
  assert.match(migration, /has_ws_role\s*\(\s*p_workspace_id\s*,\s*array\['admin'::app_role,\s*'manager'::app_role,\s*'accountant'::app_role\]/);
  assert.match(migration, /p_start is not null and v_date < p_start/);\n  assert.match(migration, /p_end is not null and v_date > p_end/);
  assert.match(migration, /revoke all on function public\.main_workspace_import_bank_statement/);
  assert.match(migration, /grant execute on function public\.main_workspace_import_bank_statement/);
});
