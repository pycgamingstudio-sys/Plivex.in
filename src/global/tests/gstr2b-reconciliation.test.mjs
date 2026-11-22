import { buildGstr1Draft } from "./gstr1-draft.js";
import { reconcileGstr2bRows } from "./gstr2b-reconciliation.js";
const toMinor=(value)=>Math.round(Number(value||0)*100);
const safeMinor=(value)=>Math.max(0,Math.round(Number(value||0)));
export function buildGstr3bDraft(invoices,gstr2bRows,purchaseBills,{from="",to="",adjustments={}}={}) {
  const outward=buildGstr1Draft(invoices,{from,to});
  const outwardRows=[...outward.b2b,...outward.b2c];
  const output={
    taxableMinor:outwardRows.reduce((sum,row)=>sum+toMinor(row.taxableValue),0),
    igstMinor:outwardRows.reduce((sum,row)=>sum+toMinor(row.igstAmount),0),
    cgstMinor:outwardRows.reduce((sum,row)=>sum+toMinor(row.cgstAmount),0),
    sgstMinor:outwardRows.reduce((sum,row)=>sum+toMinor(row.sgstAmount),0),
  };
  output.taxMinor=output.igstMinor+output.cgstMinor+output.sgstMinor;
  const reconciliation=reconcileGstr2bRows(gstr2bRows,purchaseBills);
  const matched=reconciliation.filter((row)=>row.reconciliationStatus==="MATCHED"&&row.itcAvailable!==false);
  const eligibleItc={
    igstMinor:matched.reduce((sum,row)=>sum+safeMinor(row.igstMinor),0),
    cgstMinor:matched.reduce((sum,row)=>sum+safeMinor(row.cgstMinor),0),
    sgstMinor:matched.reduce((sum,row)=>sum+safeMinor(row.sgstMinor),0),
    cessMinor:matched.reduce((sum,row)=>sum+safeMinor(row.cessMinor),0),
  };
  eligibleItc.totalMinor=eligibleItc.igstMinor+eligibleItc.cgstMinor+eligibleItc.sgstMinor+eligibleItc.cessMinor;
  const reversalMinor=safeMinor(adjustments.reversalMinor);
  const ineligibleMinor=safeMinor(adjustments.ineligibleMinor);
  const reverseChargeTaxMinor=safeMinor(adjustments.reverseChargeTaxMinor);
  const otherTaxMinor=safeMinor(adjustments.otherTaxMinor);
  const netItcMinor=Math.max(0,eligibleItc.totalMinor-reversalMinor-ineligibleMinor);
  const grossLiabilityMinor=output.taxMinor+reverseChargeTaxMinor+otherTaxMinor;
  return {
    outward,output,eligibleItc,reconciliation,
    adjustments:{reversalMinor,ineligibleMinor,reverseChargeTaxMinor,otherTaxMinor},
    netItcMinor,grossLiabilityMinor,
    netTaxPayableMinor:Math.max(0,grossLiabilityMinor-netItcMinor),
    excessItcMinor:Math.max(0,netItcMinor-grossLiabilityMinor),
    warnings:[
      ...outward.warnings,
      ...(gstr2bRows.length===0?["No GSTR-2B rows are saved for this period; eligible ITC is shown as zero."]:[]),
      ...(reconciliation.some((row)=>row.reconciliationStatus!=="MATCHED")?["Some GSTR-2B rows are unmatched, duplicated, ineligible or mismatched and are excluded from eligible ITC."]:[]),
      "Reverse-charge, exempt/nil-rated supplies, amendments, advances and other special adjustments must be checked and entered from source records.",
      "This is a preparation worksheet only; verify classifications and tax amounts before filing.",
    ],
  };
}


test("GSTR-2B rows with unknown ITC eligibility are excluded from claimable matches", () => {
  const row = parseGstr2bCsv(sample)[0];
  const unknown = reconcileGstr2bRows([{ ...row, itcAvailable: null }], [bill]);
  assert.equal(unknown[0].reconciliationStatus, "ITC_STATUS_UNKNOWN");
});
