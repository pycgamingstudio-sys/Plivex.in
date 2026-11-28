import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
const migration=read("../../../supabase/migrations/20261128130000_main_workspace_india_compliance_records.sql");
const baseMigration=read("../../../supabase/migrations/20261128130000_main_workspace_india_compliance_records.sql");
const itemMigration=read("../../../supabase/migrations/20261128130100_persist_invoice_hsn_unit_metadata.sql");
const edge=read("../../../supabase/functions/workspace-india-compliance/index.ts");
const invoiceEdge=read("../../../supabase/functions/save-invoice/index.ts");
const stores=read("../../lib/stores.js");
const panel=read("../../components/workspace/WorkspaceIndiaComplianceRecords.jsx");
const parent=read("../../components/workspace/WorkspaceGSTCompliance.jsx");
const home=read("../../pages/Home.jsx");
const taxEditor=read("../../components/invoice/GlobalTaxEditor.jsx");

test("India compliance records are workspace scoped and inaccessible to browser roles",()=>{
  for(const table of ["workspace_tds_entries","workspace_einvoice_records","workspace_eway_bill_records","workspace_compliance_provider_connections"]){
    assert.match(migration,new RegExp("create table if not exists public\\."+table));
    assert.match(migration,new RegExp("alter table public\\."+table+" enable row level security"));
  }
  assert.match(migration,/revoke all on public\.workspace_tds_entries,[\s\S]*from public,anon,authenticated/);
  assert.match(migration,/grant all on public\.workspace_tds_entries,[\s\S]*to service_role/);
  assert.match(migration,/audit_workspace_india_compliance_change/);
  assert.match(migration,/after insert or update on public\.workspace_tds_entries/);
  assert.match(edge,/updated_by:user\.id/);
});

test("TDS records use server-calculated minor-unit amounts and immutable idempotency fingerprints",()=>{
  assert.match(edge,/BigInt\(gross\)\*BigInt\(rate\)/);
  assert.match(edge,/request_fingerprint:fingerprint/);
  assert.match(edge,/financial_year:period\.financial_year/);
  assert.match(edge,/quarter:period\.quarter/);
  assert.match(edge,/idempotency key was already used for different TDS data/i);
  assert.match(edge,/transitions:Record<string,string\[]>/);
});

test("E-invoice preparation validates GSTIN, invoice lines, HSN/SAC and UQC before marking ready",()=>{
  assert.match(edge,/prepare_einvoice/);
  assert.match(edge,/gstin\(seller\.tax_registration_number\)/);
  assert.match(edge,/buyerDetails=buyer\|\|invoice\.invoice_snapshot\?\.client/);
  assert.match(edge,/gstin\(buyerDetails\?\.gstin\)/);
  assert.match(edge,/hsn_sac_code/);
  assert.match(edge,/unit_code/);
  assert.match(edge,/status:errors\.length\?"draft":"ready"/);
  assert.match(edge,/place_of_supply_state:placeOfSupply/);
  assert.match(edge,/supply_type:supplyType/);
});

test("E-way bill preparation requires transport evidence and prevents duplicate active bills",()=>{
  assert.match(edge,/prepare_eway_bill/);
  assert.match(edge,/distance<1\|\|distance>4000/);
  assert.match(edge,/!vehicle\s*&&\s*!transporter/);
  assert.match(edge,/from_gstin:seller\.tax_registration_number/);
  assert.match(edge,/to_gstin:buyerDetails\?\.gstin/);
  assert.match(edge,/status:errors\.length\?"draft":"ready"/);
  assert.match(edge,/An active e-way bill already exists/);
});

test("Provider setup stores only a Supabase secret-name reference and never accepts a secret value",()=>{
  assert.match(edge,/secret_reference/);
  assert.match(edge,/awaiting_credentials/);
  assert.match(edge,/Do not send the secret value/);
  assert.match(migration,/secret_reference text/);
  assert.doesNotMatch(migration,/api_secret text|secret_value text|access_token text/i);
});

test("Invoice HSN/SAC and UQC fields persist from the Main Workspace invoice editor to the database",()=>{
  assert.match(baseMigration,/add column if not exists hsn_sac_code text/i);
  assert.match(baseMigration,/add column if not exists unit_code text/i);
  assert.match(itemMigration,/invoice_items \(invoice_id, description, quantity, rate, gst_rate, hsn_sac_code, unit_code\)/);
  assert.match(itemMigration,/invoice_snapshot = case when jsonb_typeof\(_data->'invoice_snapshot'\)='object' then _data->'invoice_snapshot' else invoice_snapshot end/);
  assert.match(invoiceEdge,/hsn_sac_code: it\.hsn_sac_code/);
  assert.match(stores,/hsn_sac_code: str\(i\.hsnSac\)/);
  assert.match(stores,/unit_code: str\(i\.unitCode\) \|\| "OTH"/);
  assert.match(home,/Unit<select/);
  assert.match(taxEditor,/data-testid="india-place-of-supply"/);
  assert.match(taxEditor,/\["09","Uttar Pradesh"\]/);
  assert.match(invoiceEdge,/\^\(\?:\[0-9\]\{2\}\|\[A-Z\]\{2\}\)\$/);
});

test("India compliance workbench is integrated into the existing GST module and clearly labels external filing as inactive",()=>{
  assert.match(parent,/WorkspaceIndiaComplianceRecords/);
  assert.match(panel,/workspace-india-compliance/);
  assert.match(panel,/not active in this build/);
  assert.match(panel,/TDS deduction record/);
  assert.match(panel,/IRN e-invoice payload/);
  assert.match(panel,/Prepare e-way bill/);
});
