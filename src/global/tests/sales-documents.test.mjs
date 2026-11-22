import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("sales documents have workspace-scoped tables, idempotent writes and lifecycle controls",async()=>{
  const migration=await readFile(new URL("../../../supabase/migrations/20261122205000_global_sales_document_workflows.sql",import.meta.url),"utf8");
  const edge=await readFile(new URL("../../../supabase/functions/global-part4/index.ts",import.meta.url),"utf8");
  const ui=await readFile(new URL("../../components/global/GlobalPart4Panel.jsx",import.meta.url),"utf8");
  const app=await readFile(new URL("../../global/GlobalApp.jsx",import.meta.url),"utf8");
  for(const table of ["sales_orders","delivery_challans","credit_debit_notes"]){
    assert.match(migration,new RegExp("create table if not exists global\\."+table));

  }
  assert.match(migration,/foreach t in array array/);
  assert.match(migration,/global.is_workspace_member/);
  assert.match(migration,/idempotency_key uuid not null/);
  assert.match(migration,/request_fingerprint text not null/);
  assert.match(migration,/credit_note_exceeds_invoice/);
  assert.match(migration,/status in \('draft','issued','void'\)/);
  for(const action of ["create_sales_order","update_sales_order_status","create_delivery_challan","update_delivery_challan_status","create_credit_debit_note","update_credit_debit_note_status"]){
    assert.ok(edge.includes(action));
    assert.ok(migration.includes(action));
  }
  assert.match(ui,/New sales order/);
  assert.match(ui,/New delivery challan/);
  assert.match(ui,/New credit \/ debit note/);
  assert.match(app,/sales_docs/);
});

test("sales order and delivery challan status transitions are constrained",async()=>{
  const migration=await readFile(new URL("../../../supabase/migrations/20261122205000_global_sales_document_workflows.sql",import.meta.url),"utf8");
  assert.match(migration,/status in \('draft','confirmed','fulfilled','cancelled'\)/);
  assert.match(migration,/status='draft' and p_values->>'status' in \('issued','cancelled'\)/);
  assert.match(migration,/status='issued' and p_values->>'status' in \('delivered','returned','cancelled'\)/);
});
