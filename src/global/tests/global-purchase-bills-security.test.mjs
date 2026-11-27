import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261126001219_secure_global_quotation_tax_wrapper.sql", import.meta.url), "utf8");
const integration = readFileSync(new URL("../../../supabase/tests/global-accounting-part3b.integration.sql", import.meta.url), "utf8");

test("purchase bill list RPC is available to authenticated users but bound to their own identity", () => {
  assert.match(migration, /create or replace function public\.global_list_purchase_bills/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /p_user_id is distinct from auth\.uid\(\)/);
  assert.match(migration, /grant execute on function public\.global_list_purchase_bills\(uuid,uuid,integer\) to authenticated, service_role/);
  assert.match(integration, /Purchase list accepted a spoofed user id/);
});
