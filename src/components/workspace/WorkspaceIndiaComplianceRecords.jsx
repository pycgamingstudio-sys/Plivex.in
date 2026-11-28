import { useCallback,useEffect,useState } from "react";
import { supabase } from "@/api/backendClient";

const field="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const primary="rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50";
const secondary="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";
const today=()=>new Date().toISOString().slice(0,10);
const money=(minor)=>"₹"+(Number(minor||0)/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const downloadJson=(name,value)=>{const blob=new Blob([JSON.stringify(value,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};

export default function WorkspaceIndiaComplianceRecords({workspaceId}){
 const [records,setRecords]=useState({tds_entries:[],einvoices:[],eway_bills:[],providers:[]});
 const [invoices,setInvoices]=useState([]);
 const [tds,setTds]=useState({deductee_name:"",deductee_pan:"",section_code:"194C",source_type:"contractor",deduction_date:today(),payment_date:"",gross_amount:"",tds_rate:"1"});
 const [einvoiceId,setEinvoiceId]=useState("");
 const [eway,setEway]=useState({invoice_id:"",document_date:today(),distance_km:"100",transport_mode:"road",vehicle_number:"",transporter_id:""});
 const [challan,setChallan]=useState({number:"",date:today(),bsr:""});
 const [provider,setProvider]=useState({provider_type:"gst_irp",provider_name:"",environment:"sandbox",secret_reference:"PLIVEX_GST_IRP_SECRET"});
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");

 const call=useCallback(async(action,values={})=>{
  const {data,error}=await supabase.functions.invoke("workspace-india-compliance",{body:{action,workspace_id:workspaceId,...values}});
  if(error)throw error;
  if(!data?.ok)throw new Error(data?.error||"India compliance request failed.");
  return data;
 },[workspaceId]);
 const load=useCallback(async()=>{
  if(!workspaceId)return;
  const [data,inv]=await Promise.all([
   call("list"),
   supabase.from("invoices").select("id,number,issue_date,total,is_draft,status").eq("workspace_id",workspaceId).eq("is_draft",false).order("issue_date",{ascending:false}).limit(100),
  ]);
  if(inv.error)throw inv.error;
  setRecords(data);setInvoices(inv.data||[]);
  setEinvoiceId((current)=>current||inv.data?.[0]?.id||"");
  setEway((current)=>({...current,invoice_id:current.invoice_id||inv.data?.[0]?.id||""}));
 },[call,workspaceId]);
 useEffect(()=>{load().catch(e=>setError(e.message||"Compliance records could not be loaded."));},[load]);
 const run=async(fn,message)=>{
  setBusy(true);setError("");setNotice("");
  try{await fn();setNotice(message);await load();}
  catch(e){setError(e.message||"Operation failed.");}
  finally{setBusy(false);}
 };
 const addTds=(e)=>{
  e.preventDefault();
  return run(()=>call("create_tds_entry",{
   source_type:tds.source_type,deductee_name:tds.deductee_name,deductee_pan:tds.deductee_pan.toUpperCase(),
   section_code:tds.section_code,deduction_date:tds.deduction_date,payment_date:tds.payment_date||null,
   gross_amount_minor:Math.round(Number(tds.gross_amount)*100),tds_rate_bps:Math.round(Number(tds.tds_rate)*100),
   idempotency_key:crypto.randomUUID(),
  }),"TDS deduction record saved.");
 };
 const prepareEinvoice=()=>run(()=>call("prepare_einvoice",{invoice_id:einvoiceId,idempotency_key:crypto.randomUUID()}),"E-invoice payload prepared. Review validation results before provider submission.");
 const prepareEway=(e)=>{
  e.preventDefault();
  return run(()=>call("prepare_eway_bill",{...eway,distance_km:Number(eway.distance_km),idempotency_key:crypto.randomUUID()}),"E-way bill payload prepared. It has not been submitted to the portal.");
 };
 const updateTds=(entry,status)=>run(()=>call("update_tds_status",{
  entry_id:entry.id,status,
  ...(status==="deposited"?{challan_number:challan.number,challan_date:challan.date,bsr_code:challan.bsr}:{}),
 }),"TDS status updated.");
 const saveProvider=(e)=>{
  e.preventDefault();
  return run(()=>call("configure_provider",provider),"Provider setup reference saved. Add the named secret in Supabase before any sandbox connection test.");
 };
 const statusClass=(status)=>status==="acknowledged"||status==="generated"||status==="filed"?"text-emerald-700":status==="rejected"?"text-red-700":"text-amber-700";

 return <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">TDS, e-invoice & e-way bill</h2><p className="mt-1 text-xs text-slate-500">India compliance workspace · internal records and payload preparation</p></div><button className={secondary} disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}>Refresh</button></div>
  <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">GSTN/IRP submission and statutory filing are not active in this build. Plivex prepares and stores records only; provider credentials, sandbox verification and eligible portal access are still required. Never enter API secrets here.</p>
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
  {notice&&<p role="status" className="mt-3 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">{notice}</p>}

  <div className="mt-5 grid gap-4 lg:grid-cols-2">
   <form onSubmit={addTds} className="rounded-xl border p-3">
    <h3 className="text-sm font-semibold">Create TDS deduction record</h3>
    <p className="mt-1 text-xs text-slate-500">Enter the section and rate confirmed by your accountant. Plivex records the deduction; it does not yet determine statutory applicability or rates.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
     <label className="text-xs text-slate-600">Deductee name<input required maxLength="200" className={field+" mt-1"} value={tds.deductee_name} onChange={e=>setTds(v=>({...v,deductee_name:e.target.value}))}/></label>
     <label className="text-xs text-slate-600">PAN<input maxLength="10" className={field+" mt-1 uppercase"} value={tds.deductee_pan} onChange={e=>setTds(v=>({...v,deductee_pan:e.target.value.toUpperCase()}))} placeholder="ABCDE1234F"/></label>
     <label className="text-xs text-slate-600">Section<select className={field+" mt-1"} value={tds.section_code} onChange={e=>setTds(v=>({...v,section_code:e.target.value}))}>{["192","192A","194","194A","194C","194D","194H","194I","194J","194N","194Q","194R","194S","194T","195","196D"].map(x=><option key={x}>{x}</option>)}</select></label>
     <label className="text-xs text-slate-600">Source type<select className={field+" mt-1"} value={tds.source_type} onChange={e=>setTds(v=>({...v,source_type:e.target.value}))}>{["contractor","professional_fee","rent","commission","vendor_payment","other"].map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></label>
     <label className="text-xs text-slate-600">Deduction date<input required type="date" className={field+" mt-1"} value={tds.deduction_date} onChange={e=>setTds(v=>({...v,deduction_date:e.target.value}))}/></label>
     <label className="text-xs text-slate-600">Payment date (optional)<input type="date" className={field+" mt-1"} value={tds.payment_date} onChange={e=>setTds(v=>({...v,payment_date:e.target.value}))}/></label>
     <label className="text-xs text-slate-600">Gross amount (₹)<input required type="number" min="0.01" step="0.01" className={field+" mt-1"} value={tds.gross_amount} onChange={e=>setTds(v=>({...v,gross_amount:e.target.value}))}/></label>
     <label className="text-xs text-slate-600">TDS rate (%)<input required type="number" min="0" max="100" step="0.01" className={field+" mt-1"} value={tds.tds_rate} onChange={e=>setTds(v=>({...v,tds_rate:e.target.value}))}/></label>
    </div>
    <button className={primary+" mt-3"} disabled={busy}>Save TDS record</button>
   </form>

   <div className="rounded-xl border p-3">
    <h3 className="text-sm font-semibold">Prepare IRN e-invoice payload</h3>
    <p className="mt-1 text-xs text-slate-500">Requires an issued invoice, seller/buyer GSTIN, two-digit place-of-supply state, intra/inter-state supply type and HSN/SAC + UQC on every line.</p>
    <label className="mt-3 block text-xs text-slate-600">Issued invoice<select className={field+" mt-1"} value={einvoiceId} onChange={e=>setEinvoiceId(e.target.value)}><option value="">Choose invoice</option>{invoices.map(x=><option key={x.id} value={x.id}>{x.number} · {money(Math.round(Number(x.total||0)*100))}</option>)}</select></label>
    <button className={primary+" mt-3"} disabled={busy||!einvoiceId} onClick={prepareEinvoice}>Validate & prepare e-invoice</button>
    <div className="mt-4 space-y-2">{records.einvoices.map(x=><div key={x.id} className="rounded-lg bg-slate-50 p-2 text-xs"><div className="flex justify-between gap-2"><strong>{x.invoice_number}</strong><span className={statusClass(x.status)}>{x.status}</span></div>{(x.validation_errors||[]).map((msg,i)=><p key={i} className="mt-1 text-red-700">{msg}</p>)}{x.irn&&<p className="mt-1 break-all">IRN: {x.irn}</p>}<button type="button" className={secondary+" mt-2"} onClick={()=>downloadJson("Plivex-EInvoice-"+x.invoice_number+".json",x.request_payload)}>Download payload</button></div>)}{!records.einvoices.length&&<p className="text-xs text-slate-500">No e-invoice records yet.</p>}</div>
   </div>

   <form onSubmit={prepareEway} className="rounded-xl border p-3">
    <h3 className="text-sm font-semibold">Prepare e-way bill</h3>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
     <label className="text-xs text-slate-600 sm:col-span-2">Issued invoice<select required className={field+" mt-1"} value={eway.invoice_id} onChange={e=>setEway(v=>({...v,invoice_id:e.target.value}))}><option value="">Choose invoice</option>{invoices.map(x=><option key={x.id} value={x.id}>{x.number}</option>)}</select></label>
     <label className="text-xs text-slate-600">Document date<input required type="date" className={field+" mt-1"} value={eway.document_date} onChange={e=>setEway(v=>({...v,document_date:e.target.value}))}/></label>
     <label className="text-xs text-slate-600">Distance (km)<input required type="number" min="1" max="4000" className={field+" mt-1"} value={eway.distance_km} onChange={e=>setEway(v=>({...v,distance_km:e.target.value}))}/></label>
     <label className="text-xs text-slate-600">Transport mode<select className={field+" mt-1"} value={eway.transport_mode} onChange={e=>setEway(v=>({...v,transport_mode:e.target.value}))}>{["road","rail","air","ship"].map(x=><option key={x}>{x}</option>)}</select></label>
     <label className="text-xs text-slate-600">Vehicle number<input className={field+" mt-1 uppercase"} value={eway.vehicle_number} onChange={e=>setEway(v=>({...v,vehicle_number:e.target.value.toUpperCase()}))}/></label>
     <label className="text-xs text-slate-600 sm:col-span-2">Transporter ID (if vehicle not available)<input className={field+" mt-1"} value={eway.transporter_id} onChange={e=>setEway(v=>({...v,transporter_id:e.target.value.toUpperCase()}))}/></label>
    </div>
    <button className={primary+" mt-3"} disabled={busy||!eway.invoice_id}>Validate & prepare e-way bill</button>
    <div className="mt-4 space-y-2">{records.eway_bills.map(x=><div key={x.id} className="rounded-lg bg-slate-50 p-2 text-xs"><div className="flex justify-between gap-2"><strong>{x.invoice_number}</strong><span className={statusClass(x.status)}>{x.status}</span></div><p className="mt-1">{x.distance_km} km · {x.transport_mode} · {x.vehicle_number||x.transporter_id||"Transporter pending"}</p>{x.eway_bill_number&&<p>EWB: {x.eway_bill_number}</p>}{(x.validation_errors||[]).map((msg,i)=><p key={i} className="mt-1 text-red-700">{msg}</p>)}<button type="button" className={secondary+" mt-2"} onClick={()=>downloadJson("Plivex-EWayBill-"+x.invoice_number+".json",x.request_payload)}>Download payload</button></div>)}{!records.eway_bills.length&&<p className="text-xs text-slate-500">No e-way bill records yet.</p>}</div>
   </form>

   <div className="rounded-xl border p-3">
    <h3 className="text-sm font-semibold">TDS ledger & challan tracking</h3>
    <div className="mt-3 space-y-2">{records.tds_entries.map(x=><div key={x.id} className="rounded-lg bg-slate-50 p-2 text-xs"><div className="flex justify-between gap-2"><strong>{x.deductee_name} · {x.section_code}</strong><span className={statusClass(x.status)}>{x.status}</span></div><p className="mt-1">Gross {money(x.gross_amount_minor)} · TDS {money(x.tds_amount_minor)} · Net {money(x.net_amount_minor)}</p><p className="text-slate-500">{x.financial_year} · {x.quarter} · {x.deduction_date}</p>
      {x.status==="draft"&&<button className={secondary+" mt-2"} disabled={busy} onClick={()=>updateTds(x,"deducted")}>Mark deducted</button>}
      {x.status==="deducted"&&<div className="mt-2 grid gap-1"><input className={field} placeholder="Challan number" value={challan.number} onChange={e=>setChallan(v=>({...v,number:e.target.value}))}/><input className={field} type="date" value={challan.date} onChange={e=>setChallan(v=>({...v,date:e.target.value}))}/><input className={field} placeholder="BSR code" value={challan.bsr} onChange={e=>setChallan(v=>({...v,bsr:e.target.value}))}/><button className={secondary} disabled={busy} onClick={()=>updateTds(x,"deposited")}>Mark deposited</button></div>}
      {x.status==="deposited"&&<button className={secondary+" mt-2"} disabled={busy} onClick={()=>updateTds(x,"filed")}>Mark filed (manual)</button>}
     </div>)}{!records.tds_entries.length&&<p className="text-xs text-slate-500">No TDS records yet.</p>}</div>
   </div>
  </div>

  <form onSubmit={saveProvider} className="mt-4 rounded-xl border p-3">
   <h3 className="text-sm font-semibold">Compliance provider setup</h3>
   <p className="mt-1 text-xs text-slate-500">Store only the Supabase secret name reference here. Add the actual value in Supabase Edge Function Secrets, never in the browser or GitHub.</p>
   <div className="mt-3 grid gap-2 sm:grid-cols-2">
    <label className="text-xs text-slate-600">Provider type<select className={field+" mt-1"} value={provider.provider_type} onChange={e=>setProvider(v=>({...v,provider_type:e.target.value}))}><option value="gst_irp">GST IRP / GSP</option><option value="gstn">GSTN</option><option value="tds">TDS</option></select></label>
    <label className="text-xs text-slate-600">Provider name<input required className={field+" mt-1"} value={provider.provider_name} onChange={e=>setProvider(v=>({...v,provider_name:e.target.value}))}/></label>
    <label className="text-xs text-slate-600">Environment<select className={field+" mt-1"} value={provider.environment} onChange={e=>setProvider(v=>({...v,environment:e.target.value}))}><option value="sandbox">Sandbox</option><option value="production">Production</option></select></label>
    <label className="text-xs text-slate-600">Supabase secret name<input required className={field+" mt-1"} value={provider.secret_reference} onChange={e=>setProvider(v=>({...v,secret_reference:e.target.value.toUpperCase()}))}/></label>
   </div>
   <button className={secondary+" mt-3"} disabled={busy}>Save provider reference</button>
   <div className="mt-3 flex flex-wrap gap-2">{records.providers.map((x,i)=><span key={i} className="rounded-full bg-slate-100 px-2 py-1 text-[11px]">{x.provider_name} · {x.environment} · {x.status}</span>)}</div>
  </form>
 </section>;
}
