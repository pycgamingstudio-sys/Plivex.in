import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../../../supabase/migrations/20261128190000_stage2_ar_ap_aging.sql", import.meta.url);

test("AR/AP ageing is workspace-scoped and enforces authenticated membership and accounting roles", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /p_user_id is distinct from auth\.uid\(\)/i);
  assert.match(sql, /global\.workspace_members[\s\S]*workspace_id = p_workspace_id[\s\S]*status = 'active'/i);
  assert.match(sql, /v_role not in \('owner', 'admin', 'accountant', 'manager'\)/i);
  assert.match(sql, /i\.workspace_id = p_workspace_id/i);
  assert.match(sql, /b\.workspace_id = p_workspace_id/i);
});

test("AR/AP ageing reports currency-separated current and overdue buckets using minor units", async () => {
  const sql = await readFile(migration, "utf8");
  for (const bucket of ["current_minor", "days_1_30_minor", "days_31_60_minor", "days_61_90_minor", "over_90_minor"]) {
    assert.ok(sql.includes(bucket), `missing ageing bucket: ${bucket}`);
  }
  assert.match(sql, /group by currency_code/i);
  assert.match(sql, /total_minor - i\.amount_paid_minor/i);
  assert.match(sql, /total_minor - b\.amount_paid_minor/i);
  assert.match(sql, /case when i\.due_date is null then 0/i);
  assert.match(sql, /case when b\.due_date is null then 0/i);
  assert.match(sql, /greatest\(1, least\(coalesce\(p_limit, 200\), 500\)\)/i);
});

test("AR/AP ageing function is exposed only to authenticated callers", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /revoke all on function public\.global_get_ar_ap_aging\(uuid, uuid, date, integer\)[\s\S]*from public, anon/i);
  assert.match(sql, /grant execute on function public\.global_get_ar_ap_aging\(uuid, uuid, date, integer\)[\s\S]*to authenticated/i);
});
