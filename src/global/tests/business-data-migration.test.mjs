import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../../supabase/migrations/202611150003_global_business_data_foundation.sql", import.meta.url),
  "utf8",
);

test("Global business data foundation is additive and tenant-scoped", () => {
  for (const table of ["clients","products","stock_levels","invoices","invoice_items","invoice_payments","expenses"]) {
    assert.match(migration, new RegExp("create table if not exists global\\\\." + table));
    assert.match(migration, new RegExp("'" + table + "'"));
  }
  assert.match(migration, /alter table global\\.%I enable row level security/);
  assert.match(migration, /create policy global_%I_select_member/);
  assert.match(migration, /global\\.is_workspace_member\\(workspace_id\\)/);
  assert.equal(/public\\.(clients|invoices|products|expenses|stock)/i.test(migration), false);
  assert.equal(/drop table|truncate table|delete from/i.test(migration), false);
});

test("Global invoice and stock relationships cannot cross workspace boundaries", () => {
  assert.match(migration, /foreign key \\(workspace_id, client_id\\) references global\\.clients\\(workspace_id, id\\)/);
  assert.match(migration, /foreign key \\(workspace_id, invoice_id\\) references global\\.invoices\\(workspace_id, id\\)/);
  assert.match(migration, /foreign key \\(workspace_id, product_id\\) references global\\.products\\(workspace_id, id\\)/);
  assert.match(migration, /amount_minor bigint/);
  assert.match(migration, /quantity numeric\\(18,4\\)/);
});

test("Global browser role is read-only until audited business Edge Functions exist", () => {
  assert.match(migration, /grant select on global\\.clients/);
  assert.match(migration, /grant all on global\\.clients[\\s\\S]*to service_role/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all)[^;]*to authenticated/i);
});
