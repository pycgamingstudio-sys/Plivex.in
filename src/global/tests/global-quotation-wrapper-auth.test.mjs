import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261126001219_secure_global_quotation_tax_wrapper.sql", import.meta.url), "utf8");

test("tax-aware quotation wrapper is restricted to the trusted service role", () => {
  assert.ok(migration.includes("coalesce(auth.role(),'') <> 'service_role'"));
  assert.match(migration, /reason','access_denied'/);
});

test("tax-aware quotation RPC cannot be executed directly by browser roles", () => {
  assert.ok(migration.includes("p_tax_minor bigint"));
  assert.ok(migration.includes("p_tax_snapshot jsonb"));
  assert.match(migration, /revoke all on function public\.global_manage_quotation\([\s\S]*?\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.global_manage_quotation\([\s\S]*?\) to service_role/);
  assert.match(migration, /revoke all on function global\.guard_issued_invoice_items\(\) from public, anon, authenticated/);
});
