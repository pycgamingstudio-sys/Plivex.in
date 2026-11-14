import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../../supabase/migrations/202611150001_global_isolation_foundation.sql", import.meta.url),
  "utf8",
);

test("Global isolation migration is additive and uses a private schema", () => {
  assert.ok(migration.includes("create schema if not exists global"));
  assert.ok(migration.includes("revoke all on schema global from public, anon, authenticated"));
  assert.ok(migration.includes("grant usage on schema global to authenticated, service_role"));
  assert.equal(/alter\s+table\s+public\./i.test(migration), false);
  assert.equal(/drop\s+table\s+(if exists\s+)?public\./i.test(migration), false);
});

test("Global authorization is based on Global memberships, not India profiles", () => {
  assert.ok(migration.includes("global.workspace_members"));
  assert.ok(migration.includes("wm.user_id = auth.uid()"));
  assert.ok(migration.includes("global.is_workspace_member"));
  assert.equal(/public\.profiles/i.test(migration), false);
});

test("Global tenant tables enforce RLS and least-privilege provisioning", () => {
  for (const table of ["workspaces", "user_profiles", "workspace_members", "business_profiles"]) {
    assert.ok(migration.includes(`alter table global.${table} enable row level security`));
  }
  assert.ok(migration.includes("for update to authenticated"));
  assert.ok(migration.includes("No authenticated INSERT/DELETE policies"));
  assert.ok(migration.includes("grant all on all tables in schema global to service_role"));
});

test("Global workspace country and currency identifiers are constrained", () => {
  assert.ok(migration.includes("country_code ~ '^[A-Z]{2}$'"));
  assert.ok(migration.includes("currency_code ~ '^[A-Z]{3}$'"));
});
