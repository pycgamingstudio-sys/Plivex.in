import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/api/backendClient";
import { buildGstr3bDraft } from "@/global/tax/gstr3b-draft.js";
import { exportCsv } from "@/lib/dashboardData";
const field="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button="rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const secondary="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";
const periodNow=()=>new Date().toISOString().slice(0,7);
const minor=(value)=>Math.max(0,Math.round(Number(value||0)*100));
const money=(value)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(Number(value||0)/100);
const periodRange=(period)=>{
  const [year,month]=period.split("-").map(Number);
  const last=new Date(year,month,0).getDate();
  return {from:period+"-01",to:period+"-"+String(last).padStart(2,"0")};
};
export default function GlobalGstr3bPanel({account,invoke}) {
  const [period,setPeriod]=useState(periodNow);
  const [invoices,setInvoices]=useState([]);
  const [purchaseBills,setPurchaseBills]=useState([]);
  const [gstr2bRows,setGstr2bRows]=useState([]);
  const [calendar,setCalendar]=useState([]);
  const [reversal,setReversal]=useState("");
  const [ineligible,setIneligible]=useState("");
  const [reverseCharge,setReverseCharge]=useState("");
  const [otherTax,setOtherTax]=useState("");
  const [returnType,setReturnType]=useState("GSTR3B");
  const [dueDate,setDueDate]=useState("");
  const [status,setStatus]=useState("planned");
  const [reference,setReference]=useState("");
  const [notes,setNotes]=useState("");
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const country=String(account?.country_code||"").toUpperCase();
  const currency=String(account?.currency_code||"").toUpperCase();
  const range=useMemo(()=>periodRange(period),[period]);
  const draft=useMemo(()=>buildGstr3bDraft(invoices,gstr2bRows,purchaseBills,{
    ...range,adjustments:{reversalMinor:minor(reversal),ineligibleMinor:minor(ineligible),reverseChargeTaxMinor:minor(reverseCharge),otherTaxMinor:minor(otherTax)}
  }),[invoices,gstr2bRows,purchaseBills,range,reversal,ineligible,reverseCharge,otherTax]);

  const loadData=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const [invoiceResult,billResult,taxResult,calendarResult]=await Promise.all([
        invoke("invoices"),
        supabase.functions.invoke("global-accounting",{body:{action:"list_purchase_bills",workspace_id:account.workspace_id,limit:200}}),
        supabase.functions.invoke("global-accounting",{body:{action:"list_gstr2b",workspace_id:account.workspace_id,period,limit:2000}}),
        supabase.functions.invoke("global-accounting",{body:{action:"list_gst_filing_calendar",workspace_id:account.workspace_id,limit:200}}),
      ]);
      if(billResult.error)throw billResult.error;if(taxResult.error)throw taxResult.error;if(calendarResult.error)throw calendarResult.error;
      if(!billResult.data?.ok||!taxResult.data?.ok||!calendarResult.data?.ok)throw new Error("GST source records could not be loaded.");
      setInvoices(invoiceResult?.records||[]);
      setPurchaseBills(billResult.data.purchase_bills||[]);
      setGstr2bRows(taxResult.data.records||[]);
      setCalendar(calendarResult.data.records||[]);
    }catch(e){setError(e.message||"Could not prepare GSTR-3B worksheet.");}
    finally{setLoading(false);}
  },[account.workspace_id,invoke,period]);
  useEffect(()=>{loadData();},[loadData]);

  const saveCalendar=async(event)=>{
    event.preventDefault();setSaving(true);setError("");setNotice("");
    try{
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||!dueDate)throw new Error("Choose the return period and confirm the due date.");
      const {data,error:invokeError}=await supabase.functions.invoke("global-accounting",{body:{
        action:"save_gst_filing_calendar",workspace_id:account.workspace_id,return_type:returnType,period,due_date:dueDate,status,filing_reference:reference,notes
      }});
      if(invokeError)throw invokeError;if(!data?.ok)throw new Error(data?.error||"GST filing date could not be saved.");
      setNotice("Your confirmed GST filing date was saved.");setReference("");setNotes("");await loadData();
    }catch(e){setError(e.message||"Could not save GST filing calendar.");}
    finally{setSaving(false);}
  };

  if(country!=="IN"||currency!=="INR")return <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-bold">GSTR-3B / GST filing calendar</h2><p className="mt-2 text-sm text-slate-600">This India GST workflow is available only in an India / INR workspace.</p></div>;
  return <div className="space-y-4">
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">GSTR-3B preparation worksheet</h2><p className="mt-1 text-xs text-slate-500">Draft outward tax and matched eligible ITC from saved invoices and GSTR-2B records. No return is filed or tax posted automatically.</p></div><div className="flex flex-wrap gap-2"><button type="button" className={secondary} onClick={()=>exportCsv("plivex-gstr3b-draft-"+period+".csv",[{section:"Outward taxable value",amount_minor:draft.output.taxableMinor},{section:"Output IGST",amount_minor:draft.output.igstMinor},{section:"Output CGST",amount_minor:draft.output.cgstMinor},{section:"Output SGST",amount_minor:draft.output.sgstMinor},{section:"Eligible ITC",amount_minor:draft.eligibleItc.totalMinor},{section:"ITC reversals",amount_minor:draft.adjustments.reversalMinor},{section:"Ineligible ITC",amount_minor:draft.adjustments.ineligibleMinor},{section:"Reverse-charge tax",amount_minor:draft.adjustments.reverseChargeTaxMinor},{section:"Net tax payable",amount_minor:draft.netTaxPayableMinor}] )}>Export draft</button><button type="button" className={secondary} disabled={loading} onClick={loadData}>{loading?"Refreshing…":"Refresh source records"}</button></div></div>
      <label className="mt-4 block max-w-xs text-xs font-semibold text-slate-600">Return period<input className={field+" mt-1"} type="month" value={period} onChange={(e)=>setPeriod(e.target.value)}/></label>
      {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice&&<p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["3.1 outward taxable value",money(draft.output.taxableMinor)],["Output tax",money(draft.output.taxMinor)],["Matched eligible ITC",money(draft.eligibleItc.totalMinor)],["Net tax payable estimate",money(draft.netTaxPayableMinor)]].map(([label,value])=><div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>)}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4"><h3 className="text-sm font-bold">Output tax breakdown</h3><div className="mt-3 space-y-2 text-sm">{[["Taxable value",draft.output.taxableMinor],["IGST",draft.output.igstMinor],["CGST",draft.output.cgstMinor],["SGST",draft.output.sgstMinor]].map(([label,value])=><div key={label} className="flex justify-between"><span>{label}</span><strong>{money(value)}</strong></div>)}</div></div>
        <div className="rounded-lg border border-slate-200 p-4"><h3 className="text-sm font-bold">Matched ITC breakdown</h3><div className="mt-3 space-y-2 text-sm">{[["IGST",draft.eligibleItc.igstMinor],["CGST",draft.eligibleItc.cgstMinor],["SGST",draft.eligibleItc.sgstMinor],["Cess",draft.eligibleItc.cessMinor],["Total eligible ITC",draft.eligibleItc.totalMinor]].map(([label,value])=><div key={label} className="flex justify-between"><span>{label}</span><strong>{money(value)}</strong></div>)}</div></div>
      </div>
      <div className="mt-4 rounded-lg border border-slate-200 p-4"><h3 className="text-sm font-bold">Manual adjustments (₹)</h3><p className="mt-1 text-[11px] text-slate-500">Enter amounts from source records where applicable; these are not inferred by Plivex.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["ITC reversals",reversal,setReversal],["Ineligible ITC",ineligible,setIneligible],["Reverse-charge tax",reverseCharge,setReverseCharge],["Other tax payable",otherTax,setOtherTax]].map(([label,value,setter])=><label key={label} className="text-xs font-semibold text-slate-600">{label}<input className={field+" mt-1"} type="number" min="0" step="0.01" value={value} onChange={(e)=>setter(e.target.value)}/></label>)}
      </div><div className="mt-3 flex flex-wrap justify-between gap-2 border-t pt-3 text-sm"><span>Net ITC after adjustments</span><strong>{money(draft.netItcMinor)}</strong><span>Net tax payable</span><strong>{money(draft.netTaxPayableMinor)}</strong><span>Excess ITC balance</span><strong>{money(draft.excessItcMinor)}</strong></div></div>
      {draft.warnings.length>0&&<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-900">Review before filing</p><ul className="mt-1 list-disc pl-4 text-[11px] text-amber-800">{draft.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}
    </div>
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-bold">GST filing calendar</h2><p className="mt-1 text-xs text-slate-500">Enter the due date confirmed from the official GST portal or your tax professional. Plivex does not guess or auto-assign statutory deadlines.</p>
      <form onSubmit={saveCalendar} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-semibold text-slate-600">Return type<select className={field+" mt-1"} value={returnType} onChange={(e)=>setReturnType(e.target.value)}><option value="GSTR3B">GSTR-3B</option><option value="GSTR1">GSTR-1</option></select></label>
        <label className="text-xs font-semibold text-slate-600">Due date<input required type="date" className={field+" mt-1"} value={dueDate} onChange={(e)=>setDueDate(e.target.value)}/></label>
        <label className="text-xs font-semibold text-slate-600">Status<select className={field+" mt-1"} value={status} onChange={(e)=>setStatus(e.target.value)}><option value="planned">Planned</option><option value="filed">Filed</option></select></label>
        <label className="text-xs font-semibold text-slate-600">Filing reference (optional)<input maxLength={120} className={field+" mt-1"} value={reference} onChange={(e)=>setReference(e.target.value)}/></label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2 lg:col-span-3">Notes (optional)<input maxLength={500} className={field+" mt-1"} value={notes} onChange={(e)=>setNotes(e.target.value)}/></label>
        <button className={button} disabled={saving}>{saving?"Saving…":"Save confirmed filing date"}</button>
      </form>
      <div className="mt-4 overflow-x-auto"><table className="min-w-[600px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Return","Period","Confirmed due date","Status","Reference"].map((x)=><th key={x} className="px-3 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{calendar.map((row)=><tr key={row.id}><td className="px-3 py-3 font-semibold">{row.return_type}</td><td className="px-3 py-3">{row.return_period}</td><td className="px-3 py-3">{row.due_date}</td><td className="px-3 py-3">{row.status}</td><td className="px-3 py-3">{row.filing_reference||"—"}</td></tr>)}</tbody></table>{!calendar.length&&<p className="p-4 text-center text-xs text-slate-500">No filing dates saved yet.</p>}</div>
    </div>
  </div>;
}
