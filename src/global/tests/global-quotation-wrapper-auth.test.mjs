import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261125152000_secure_global_quotation_tax_wrapper.sql", import.meta.url), "utf8");

test("tax-aware quotation wrapper binds caller identity to the authenticated JWT", () => {
  assert.match(migration, /auth\.uid\(\)\s+is\s+null/);
  assert.match(migration, /p_user_id\s+is\s+distinct\s+from\s+auth\.uid\(\)/);
  assert.match(migration, /reason','access_denied'/);
});

test("tax-aware quotation wrapper preserves the restricted legacy overload", () => {
  assert.ok(migration.includes("p_idempotency_key uuid"));
  assert.ok(migration.includes("p_tax_minor bigint"));
  assert.ok(migration.includes("p_tax_snapshot jsonb"));
  assert.ok(migration.includes("revoke all on function public.global_manage_quotation("));
  assert.ok(migration.includes(") to authenticated;"));
  assert.ok(migration.includes("uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb"));
  assert.match(migration, /revoke all on function global\\.guard_issued_invoice_items\\(\\) from public, anon, authenticated/);
});
