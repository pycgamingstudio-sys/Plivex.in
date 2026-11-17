import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Global share migration is single-copy, RLS protected and service-role only", async () => {
  const sql = await read("../../../supabase/migrations/202611170003_ready_plivex_global_invoice_and_sharing.sql");
  assert.equal((sql.match(/create or replace function public\.global_create_invoice_share/g) || []).length, 1);
  assert.equal((sql.match(/create or replace function public\.global_check_invoice_share_rate_limit/g) || []).length, 1);
  assert.match(sql, /alter table global\.invoice_share_rate_limits enable row level security/i);
  assert.match(sql, /revoke all on global\.invoice_share_rate_limits from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function public\.global_check_invoice_share_rate_limit\(text,integer,integer\) to service_role/i);
  assert.match(sql, /currency_mismatch/);
  assert.match(sql, /-'email'-'phone'/);
});

test("Public Global share endpoint hashes client IP and bearer token before SQL RPCs", async () => {
  const edge = await read("../../../supabase/functions/global-invoice-share/index.ts");
  assert.match(edge, /cf-connecting-ip/);
  assert.match(edge, /hashToken\(pepper \+ ":" \+ clientIp\)/);
  assert.match(edge, /global_check_invoice_share_rate_limit/);
  assert.match(edge, /hashToken\(body\.token\)/);
  assert.doesNotMatch(edge, /p_token_hash:\s*body\.token/);
});

test("Public invoice page refuses missing country/currency instead of guessing USD", async () => {
  const page = await read("../../pages/PublicInvoicePage.jsx");
  assert.match(page, /snapshot\.currency_code/);
  assert.match(page, /shared\.country_code/);
  assert.doesNotMatch(page, /snapshot\.currency_code\s*\|\|\s*"USD"/);
});
