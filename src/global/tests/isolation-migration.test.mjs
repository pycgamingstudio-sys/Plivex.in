import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../../supabase/migrations/202611150001_global_isolation_foundation.sql", import.meta.url),
  "utf8",
);

test("Global isolation migration is additive and uses a private schema", () => {
  assert.match(migration, /create schema if not exists global/i);
  assert.match(migration, /revoke all on schema global from public, anon, authenticated/i);
  assert.match(migration, /grant usage on schema global to service_role/i);
  assert.doesNotMatch(migration, /alter table public\./i);
  assert.doesNotMatch(migration, /drop table\s+(if exists\s+)?public\./i);
});

test("Global authorization is based on Global memberships, not India profiles", () => {
  assert.match(migration, /global\.workspace_members/);
  assert.match(migration, /wm\.user_id = auth\.uid\(\)/);
  assert.match(migration, /global\.is_workspace_member/);
  assert.doesNotMatch(migration, /public\.profiles/i);
});

test("Global tenant tables enforce RLS and least-privilege provisioning", () => {
  for (const table of ["workspaces", "user_profiles", "workspace_members", "business_profiles"]) {
    assert.match(migration, new RegExp(`alter table global\\.${table} enable row level security`, "i"));
  }
  assert.match(migration, /for update to authenticated/i);
  assert.match(migration, /No authenticated INSERT\/DELETE policies/i);
  assert.match(migration, /grant all on all tables in schema global to service_role/i);
});

test("Global workspace data has constrained country, locale and currency identifiers", () => {
  assert.match(migration, /country_code text not null check \(country_code ~ '\^\[A-Z\]\{2\}\$'\)/);
  assert.match(migration, /currency_code text not null check \(currency_code ~ '\^\[A-Z\]\{3\}\$'\)/);
});
