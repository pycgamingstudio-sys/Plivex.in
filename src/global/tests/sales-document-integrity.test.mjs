import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration=readFileSync(new URL("../../../supabase/migrations/20261128140000_main_workspace_sales_idempotency_hardening.sql",import.meta.url),"utf8");
const panel=readFileSync(new URL("../../components/workspace/WorkspaceSalesDocuments.jsx",import.meta.url),"utf8");

test("Main Workspace sales documents bind each idempotency key to a canonical request fingerprint",()=>{
  for(const table of ["sales_orders","delivery_challans","credit_debit_notes"]){
    assert.match(migration,new RegExp("alter table public\\."+table+" add column request_fingerprint text"));
    assert.match(migration,new RegExp(table+"_request_fingerprint_format"));
  }
  assert.equal((migration.match(/pg_catalog\.sha256\(/g)||[]).length,3);
  assert.equal((migration.match(/pg_advisory_xact_lock\(/g)||[]).length,3);
  assert.equal((migration.match(/reason','idempotency_conflict/g)||[]).length,3);
  assert.match(migration,/request_fingerprint is distinct from v_fingerprint/);
});

test("Delivery challans reject duplicate order-item lines in one request",()=>{
  assert.match(migration,/duplicate_challan_item/);
  assert.match(migration,/jsonb_array_elements\(p_items\) as x\(item\)/);
});

test("A sales order cannot be marked fulfilled until all ordered quantities have dispatched or been received",()=>{
  assert.match(migration,/fulfillment_incomplete/);
  assert.match(migration,/dc\.status in \('dispatched','received'\)/);
  assert.match(migration,/sum\(dci\.quantity\)/);
});

test("Draft delivery challans reserve quantities without prematurely marking the order fulfilled",()=>{
  assert.match(migration,/dc\.status in \('draft','dispatched','received'\)/);
  assert.doesNotMatch(migration,/update public\.sales_orders set status='partially_fulfilled',updated_at=now\(\) where id=v_order\.id/);
  assert.match(migration,/returning id,sales_order_id into v_found,v_sales_order/);
  assert.match(migration,/then 'fulfilled'[\s\S]*then 'partially_fulfilled'[\s\S]*else 'confirmed' end/);
});

test("Sales document UI retains each idempotency key until a successful save",()=>{
  assert.match(panel,/orderKey/);
  assert.match(panel,/noteKey/);
  assert.match(panel,/challanKeys/);
  assert.match(panel,/if\(ok\)setOrderKey\(crypto\.randomUUID\(\)\)/);
});
