import { useMemo, useState } from "react";
import { supabase } from "@/api/backendClient";
import { Download, FileUp, RefreshCw } from "lucide-react";
import { exportCsv } from "@/lib/dashboardData";
import { parseGstr2bCsv, reconcileGstr2bRows } from "@/global/tax/gstr2b-reconciliation.js";
const field="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button="rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const secondary="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";
const periodNow=()=>new Date().toISOString().slice(0,7);
export default function GlobalGstr2bPanel({account}) {
  const [period,setPeriod]=useState(periodNow),[preview,setPreview]=useState([]),[savedRows,setSavedRows]=useState([]),[purchaseBills,setPurchaseBills]=useState([]);
  const [loading,setLoading]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[fileName,setFileName]=useState("");
  const country=String(account?.country_code||"").toUpperCase(),currency=String(account?.currency_code||"").toUpperCase();
  const reconciled=useMemo(()=>reconcileGstr2bRows(savedRows.length?savedRows:preview,purchaseBills),[savedRows,preview,purchaseBills]);
  const counts=useMemo(()=>reconciled.reduce((result,row)=>{result[row.reconciliationStatus]=(result[row.reconciliationStatus]||0)+1;return result;},{}),[reconciled]);
  const loadData=async()=>{
    setLoading(true);setError("");setNotice("");
    try{
      const [billsResult,rowsResult]=await Promise.all([
        supabase.functions.invoke("global-accounting",{body:{action:"list_purchase_bills",workspace_id:account.workspace_id,limit:200}}),
        supabase.functions.invoke("global-accounting",{body:{action:"list_gstr2b",workspace_id:account.workspace_id,period,limit:2000}}),
      ]);
      if(billsResult.error)throw billsResult.error;if(rowsResult.error)throw rowsResult.error;
      if(!billsResult.data?.ok||!rowsResult.data?.ok)throw new Error("Could not load purchase bills or saved GSTR-2B rows.");
      setPurchaseBills(billsResult.data.purchase_bills||[]);setSavedRows(rowsResult.data.records||[]);setNotice("Saved return and purchase bills refreshed.");
    }catch(e){setError(e.message||"Could not load GSTR-2B data.");}finally{setLoading(false);}
  };
  const readFile=async(event)=>{
    const file=event.target.files?.[0];if(!file)return;
    setError("");setNotice("");setPreview([]);setSavedRows([]);setFileName(file.name);
    try{
      const rows=parseGstr2bCsv(await file.text());if(!rows.length)throw new Error("No valid GSTR-2B rows found. Check GSTIN, invoice number and invoice date.");
      setPreview(rows);
      const {data,error:invokeError}=await supabase.functions.invoke("global-accounting",{body:{action:"list_purchase_bills",workspace_id:account.workspace_id,limit:200}});
      if(invokeError)throw invokeError;if(!data?.ok)throw new Error("Purchase bills could not be loaded.");
      setPurchaseBills(data.purchase_bills||[]);
    }catch(e){setError(e.message||"Could not read this GSTR-2B file.");}
    event.target.value="";
  };
  const importRows=async()=>{
    setLoading(true);setError("");setNotice("");
    try{
      if(!/^\\d{4}-(0[1-9]|1[0-2])$/.test(period))throw new Error("Choose a valid GSTR-2B return period.");
      const rows=preview.filter((row)=>!row.duplicate).map(({duplicate,sourceRow,...row})=>row);
      const {data,error:invokeError}=await supabase.functions.invoke("global-accounting",{body:{action:"import_gstr2b",workspace_id:account.workspace_id,period,rows}});
      if(invokeError)throw invokeError;if(!data?.ok)throw new Error(data?.error||"GSTR-2B import could not be saved.");
      const [listRows,bills]=await Promise.all([
        supabase.functions.invoke("global-accounting",{body:{action:"list_gstr2b",workspace_id:account.workspace_id,period,limit:2000}}),
        supabase.functions.invoke("global-accounting",{body:{action:"list_purchase_bills",workspace_id:account.workspace_id,limit:200}}),
      ]);
      if(listRows.error)throw listRows.error;if(bills.error)throw bills.error;
      setSavedRows(listRows.data?.records||[]);setPurchaseBills(bills.data?.purchase_bills||[]);setPreview([]);
      setNotice("GSTR-2B rows saved. Review the reconciliation; no ITC or journal entry was posted.");
    }catch(e){setError(e.message||"GSTR-2B import failed.");}finally{setLoading(false);}
  };
  if(country!=="IN"||currency!=="INR")return <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-bold">GSTR-2B / ITC reconciliation</h2><p className="mt-2 text-sm text-slate-600">This India GST workflow is available only in an India / INR workspace.</p></div>;
  return <div className="space-y-4">
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">GSTR-2B import & ITC reconciliation</h2><p className="mt-1 text-xs text-slate-500">Import a GST portal CSV and compare supplier GSTIN, invoice and tax values with saved purchase bills.</p></div><button type="button" className={secondary} disabled={loading} onClick={loadData}><RefreshCw className="mr-1 inline h-4 w-4"/>{loading?"Loading…":"Refresh saved data"}</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]"><label className="text-xs font-semibold text-slate-600">Return period<input className={field+" mt-1"} type="month" value={period} onChange={(e)=>setPeriod(e.target.value)}/></label><label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-violet-300 bg-violet-50/50 px-4 py-3 text-sm font-semibold text-violet-800"><FileUp className="h-5 w-5"/>Choose GSTR-2B CSV<input className="hidden" type="file" accept=".csv,text/csv" onChange={readFile}/></label></div>
      {fileName&&<p className="mt-2 text-xs text-slate-500">Selected: {fileName}</p>}
      {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice&&<p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {preview.length>0&&<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-amber-900">{preview.length} parsed row(s). Review before importing this return period.</p><button type="button" className={button} disabled={loading} onClick={importRows}>Import & save rows</button></div>}
    </div>
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{[["Matched",counts.MATCHED||0],["Amount mismatch",counts.AMOUNT_MISMATCH||0],["Not in books",counts.NOT_IN_BOOKS||0],["Duplicate",counts.DUPLICATE||0],["ITC unavailable",counts.ITC_NOT_AVAILABLE||0]].map(([label,value])=><div key={label} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>)}</div>
    {reconciled.length>0&&<div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><div><h3 className="text-sm font-bold">ITC reconciliation review</h3><p className="text-[11px] text-slate-500">Matches are review suggestions only. Plivex does not claim ITC automatically.</p></div><button className={secondary} type="button" onClick={()=>exportCsv("plivex-gstr2b-itc-"+period+".csv",reconciled)}><Download className="mr-1 inline h-4 w-4"/>Export review</button></div><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Supplier GSTIN","Invoice","Date","Taxable","Portal tax","Books tax","Status","Review"].map((x)=><th key={x} className="px-3 py-3 font-semibold">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{reconciled.map((row,index)=><tr key={row.supplierGstin+"-"+row.invoiceNumber+"-"+row.invoiceDate+"-"+index}><td className="px-3 py-3 font-mono">{row.supplierGstin}</td><td className="px-3 py-3">{row.invoiceNumber}</td><td className="px-3 py-3">{row.invoiceDate}</td><td className="px-3 py-3">{(row.taxableValueMinor/100).toFixed(2)}</td><td className="px-3 py-3">{((row.igstMinor+row.cgstMinor+row.sgstMinor+row.cessMinor)/100).toFixed(2)}</td><td className="px-3 py-3">{(Number(row.bookTaxMinor||0)/100).toFixed(2)}</td><td className="px-3 py-3 font-bold">{row.reconciliationStatus}</td><td className="px-3 py-3">{row.matchReason}</td></tr>)}</tbody></table></div>}
    <p className="text-xs text-slate-500">This stores imported return rows and reconciles them with purchase bills. It does not connect to GSTN, submit returns, or automatically claim/post ITC. Verify eligibility before filing.</p>
  </div>;
}
