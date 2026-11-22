import test from "node:test";
import assert from "node:assert/strict";
import { buildGstr3bDraft } from "../tax/gstr3b-draft.js";
const invoice={
  number:"INV-3B",issueDate:"2026-10-12",status:"Pending",isDraft:false,subtotal:1000,total:1180,
  invoiceSnapshot:{business:{gstin:"09AAACB1234C1Z5"},client:{name:"Buyer",gstin:"09AAACB1234C1Z5"},taxMode:"split",items:[{description:"Service",quantity:1,rate:1000,gstRate:18,hsnSac:"9983"}]},
  items:[{description:"Service",quantity:1,rate:1000,gstRate:18,hsnSac:"9983"}],
};
const bill={id:"bill-3b",status:"posted",supplier_tax_id:"09AAACB1234C1Z5",supplier_invoice_number:"PUR-3B",currency_code:"INR",base_currency_code:"INR",subtotal_minor:50000,tax_minor:9000,tax_recoverable_minor:9000,total_minor:59000};
const gstr2b={supplier_gstin:"09AAACB1234C1Z5",invoice_number:"PUR-3B",invoice_date:"2026-10-02",invoice_value_minor:59000,taxable_value_minor:50000,igst_minor:0,cgst_minor:4500,sgst_minor:4500,cess_minor:0,itc_available:true};
test("GSTR-3B worksheet calculates outward tax and only matched eligible ITC",()=>{
 const draft=buildGstr3bDraft([invoice],[gstr2b],[bill],{from:"2026-10-01",to:"2026-10-31"});
 assert.equal(draft.output.taxableMinor,100000);
 assert.equal(draft.output.cgstMinor,9000);
 assert.equal(draft.output.sgstMinor,9000);
 assert.equal(draft.eligibleItc.totalMinor,9000);
 assert.equal(draft.netTaxPayableMinor,9000);
});
test("GSTR-3B reversals and reverse-charge adjustments are kept separate",()=>{
 const draft=buildGstr3bDraft([invoice],[gstr2b],[bill],{from:"2026-10-01",to:"2026-10-31",adjustments:{reversalMinor:1000,ineligibleMinor:500,reverseChargeTaxMinor:2000}});
 assert.equal(draft.netItcMinor,7500);
 assert.equal(draft.grossLiabilityMinor,20000);
 assert.equal(draft.netTaxPayableMinor,12500);
});
test("GSTR-3B excludes unmatched or non-INR purchase bills from ITC",()=>{
 const foreign={...bill,currency_code:"USD"};
 const draft=buildGstr3bDraft([], [gstr2b], [foreign]);
 assert.equal(draft.eligibleItc.totalMinor,0);
 assert.ok(draft.warnings.some((warning)=>warning.includes("unmatched")));
});
