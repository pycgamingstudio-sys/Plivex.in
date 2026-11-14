import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../../supabase/migrations/202611150002_global_owner_provisioning.sql", import.meta.url),
  "utf8",
);

test("Global owner provisioning uses serialized, idempotent Global-only writes", () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/);
  assert.match(migration, /global\.workspace_members/);
  assert.match(migration, /global\.user_profiles/);
  assert.match(migration, /global\.business_profiles/);
  assert.match(migration, /membership_requires_review/);
  assert.match(migration, /unsupported_country_locale_currency/);
  assert.equal(/public\.profiles/i.test(migration), false);
  assert.equal(/public\.workspace_members/i.test(migration), false);
});

test("Global public RPC wrappers are service-role-only and use a fixed search path", () => {
  for (const name of ["global_get_auth_context", "global_provision_owner_workspace", "global_update_user_profile"]) {
    assert.match(migration, new RegExp("create or replace function public\\." + name));
    assert.match(migration, new RegExp("revoke all on function public\\." + name));
    assert.match(migration, new RegExp("grant execute on function public\\." + name));
  }
  assert.equal((migration.match(/set search_path = pg_catalog, global/g) || []).length, 3);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
});

test("Global profile updates cannot modify membership or workspace authorization", () => {
  const start = migration.indexOf("create or replace function public.global_update_user_profile");
  const functionBodyStart = migration.indexOf("as $function$", start);
  const end = migration.indexOf("$function$;", functionBodyStart + 12);
  const body = migration.slice(functionBodyStart, end);
  assert.match(body, /update global\.user_profiles/);
  assert.doesNotMatch(body, /workspace_members|workspaces|role\s*=|workspace_id\s*=/);
});
