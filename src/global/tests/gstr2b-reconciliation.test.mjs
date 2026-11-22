import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseGstr2bCsv, reconcileGstr2bRows } from "../tax/gstr2b-reconciliation.js";

const sample='GSTIN of supplier,Trade/Legal name,Invoice number,Invoice Date,Invoice Value,Taxable Value,Integrated Tax,Central Tax,State/UT Tax,Cess,ITC Available,Reason\n09AAACB1234C1Z5,"Acme, Supplies",AC-101,2026-10-05,1180,1000,0,90,90,0,Yes,\n';
const bill={id:"bill-1",status:"posted",supplier_tax_id:"09AAACB1234C1Z5",supplier_invoice_number:"AC-101",supplier_name:"Acme Supplies",currency_code:"INR",base_currency_code:"INR",subtotal_minor:100000,tax_minor:18000,tax_recoverable_minor:18000,total_minor:118000};

test("GSTR-2B parser handles quoted supplier names and GST tax columns",()=>{
  const rows=parseGstr2bCsv(sample);
  assert.equal(rows.length,1);
  assert.equal(rows[0].supplierName,"Acme, Supplies");
  assert.equal(rows[0].taxableValueMinor,100000);
  assert.equal(rows[0].cgstMinor+rows[0].sgstMinor,18000);
  assert.equal(rows[0].itcAvailable,true);
});

test("GSTR-2B reconciliation matches supplier GSTIN, invoice number and tax values",()=>{
  const rows=reconcileGstr2bRows(parseGstr2bCsv(sample),[bill]);
  assert.equal(rows[0].reconciliationStatus,"MATCHED");
  assert.equal(rows[0].matchedPurchaseBillId,"bill-1");
});

test("GSTR-2B flags amount mismatches and missing books entries",()=>{
  const parsed=parseGstr2bCsv(sample);
  assert.equal(reconcileGstr2bRows([{...parsed[0],taxableValueMinor:99000}],[bill])[0].reconciliationStatus,"AMOUNT_MISMATCH");
  assert.equal(reconcileGstr2bRows(parsed,[])[0].reconciliationStatus,"NOT_IN_BOOKS");
});

test("GSTR-2B duplicates and unavailable ITC are never claimable",()=>{
  const parsed=parseGstr2bCsv(sample);
  const rows=reconcileGstr2bRows([{...parsed[0],duplicate:true},{...parsed[0],itcAvailable:false,reason:"Blocked credit"}],[bill]);
  assert.equal(rows[0].reconciliationStatus,"DUPLICATE");
  assert.equal(rows[1].reconciliationStatus,"ITC_NOT_AVAILABLE");
});

test("GSTR-2B parser rejects missing columns and invalid GSTIN rows",()=>{
  assert.throws(()=>parseGstr2bCsv("Date,Amount\n2026-10-01,100"),/must include supplier GSTIN/);
  assert.equal(parseGstr2bCsv(sample.replace("09AAACB1234C1Z5","99AAACB1234C1Z5")).length,0);
});

test("GSTR-2B date parser accepts common Indian portal date formats",()=>{
  const rows=parseGstr2bCsv(sample.replace("2026-10-05","05-Oct-2026"));
  assert.equal(rows[0].invoiceDate,"2026-10-05");
});

test("GSTR-2B rows with unknown ITC eligibility are excluded from claimable matches",()=>{
  const row=parseGstr2bCsv(sample)[0];
  const unknown=reconcileGstr2bRows([{...row,itcAvailable:null}],[bill]);
  assert.equal(unknown[0].reconciliationStatus,"ITC_STATUS_UNKNOWN");
});

test("GSTR-2B persistence and filing calendar enforce workspace membership and India country",async()=>{
  const migration=await readFile(new URL("../../../supabase/migrations/20261122202000_global_gstr2b_import_itc_reconciliation.sql",import.meta.url),"utf8");
  const edge=await readFile(new URL("../../../supabase/functions/global-accounting/index.ts",import.meta.url),"utf8");
  assert.match(migration,/alter table global\.gstr2b_import_rows enable row level security/);
  assert.match(migration,/global\.is_workspace_member\(workspace_id\)/);
  assert.match(migration,/GSTR-2B is available only for India workspaces/);
  assert.match(migration,/global_save_gst_filing_calendar/);
  assert.match(migration,/GST filing calendar is available only for India workspaces/);
  assert.match(edge,/global_import_gstr2b_rows/);
  assert.match(edge,/global_list_gstr2b_rows/);
  assert.match(edge,/global_save_gst_filing_calendar/);
});
