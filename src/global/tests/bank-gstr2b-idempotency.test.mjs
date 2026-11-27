import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, "../../../supabase/migrations/20261127065500_bind_bank_and_gstr2b_import_idempotency.sql"), "utf8");

test("bank statement import binds idempotency key to canonical payload", () => {
 assert.match(sql,/bank_statement_imports[\s\S]*?request_fingerprint text/i);
 assert.match(sql,/main_workspace_import_bank_statement[\s\S]*?idempotency_conflict/i);
 assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\(/i);
 assert.match(sql,/bank_account_id',p_bank_account_id[\s\S]*?'rows'/i);
});
test("GSTR2B import binds idempotency key to canonical payload", () => {
 assert.match(sql,/workspace_gstr2b_imports[\s\S]*?request_fingerprint text/i);
 assert.match(sql,/main_workspace_import_gstr2b[\s\S]*?idempotency_conflict/i);
 assert.match(sql,/period_start',p_period_start[\s\S]*?'rows'/i);
});
