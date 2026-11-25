import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(new URL("../../../supabase/migrations/20261125152000_secure_global_quotation_tax_wrapper.sql", import.meta.url), "utf8");

test("tax-aware quotation wrapper binds caller identity to the authenticated JWT", () => {
  assert.match(migration, /auth\.uid\(\)\s+is\s+null/);
  assert.match(migration, /p_user_id\s+is\s+distinct\s+from\s+auth\.uid\(\)/);
  assert.match(migration, /reason','access_denied'/);
});

test("tax-aware quotation wrapper keeps the service-role-only legacy overload isolated", () => {
  assert.match(migration, /public\.global_manage_quotation\([\s\S]*?p_idempotency_key\s*\)/);
  assert.match(migration, /revoke all on function public\.global_manage_quotation\([\s\S]*?bigint,jsonb\s*\) from public, anon/);
  assert.match(migration, /grant execute on function public\.global_manage_quotation\([\s\S]*?bigint,jsonb\s*\) to authenticated/);
});
