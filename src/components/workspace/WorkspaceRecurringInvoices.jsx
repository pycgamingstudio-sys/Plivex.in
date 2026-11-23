import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/api/backendClient";
import { Repeat, RefreshCw } from "lucide-react";

const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button="rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const outline="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");};

export default function WorkspaceRecurringInvoices(){
 const {user}=useAuth();const workspaceId=user?.workspace_id;const currency=user?.currency_code||"";
 const [invoices,setInvoices]=useState([]);const [schedules,setSchedules]=useState([]);
 const [form,setForm]=useState({invoiceId:"",frequency:"monthly",interval:"1",nextRun:today(),endOn:""});
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const load=useCallback(async()=>{
  if(!workspaceId)return;
  const [i,s]=await Promise.all([
   supabase.from("invoices").select("id,number,status,total,currency,is_draft").eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(100),
   supabase.rpc("main_workspace_list_recurring_invoice_schedules",{p_workspace_id:workspaceId})
  ]);
  if(i.error)throw i.error;if(s.error)throw s.error;if(s.data?.ok===false)throw new Error(s.data.reason||"Schedule list unavailable.");
  setInvoices((i.data||[]).filter(x=>!x.is_draft&&!["draft","cancelled","void"].includes(String(x.status).toLowerCase())));
  setSchedules(s.data?.schedules||[]);
 },[workspaceId]);
 useEffect(()=>{load().catch(e=>setError(e.message||"Could not load recurring invoices."));},[load]);
 const run=async(fn,message)=>{setBusy(true);setError("");setNotice("");try{await fn();setNotice(message);await load();}catch(e){setError(e.message||"Operation failed.");}finally{setBusy(false);}};
 const rpc=async(name,args)=>{const {data,error}=await supabase.rpc(name,args);if(error)throw error;if(data?.ok===false)throw new Error(data.reason||"Request rejected.");return data;};
 const create=e=>{e.preventDefault();return run(()=>rpc("main_workspace_create_recurring_invoice_schedule",{p_workspace_id:workspaceId,p_source_invoice_id:form.invoiceId,p_frequency:form.frequency,p_interval_count:Number(form.interval),p_next_run_on:form.nextRun,p_end_on:form.endOn||null}),"Recurring invoice schedule created. Future invoices will be created as drafts for review.");};
 const setStatus=(id,status)=>run(()=>rpc("main_workspace_recurring_schedule_set_status",{p_workspace_id:workspaceId,p_schedule_id:id,p_status:status}),"Schedule updated.");
 if(!["admin","manager"].includes(user?.role))return null;
 return <section className="rounded-2xl border bg-white p-4 sm:p-5">
  <div className="flex items-center gap-2"><Repeat className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Recurring invoices</h2></div>
  <p className="mt-1 text-xs text-slate-500">Schedules generate draft invoices from an issued invoice template. They never auto-issue or send invoices; review the country-specific tax snapshot before issuing each draft.</p>
  <form onSubmit={create} className="mt-4 grid gap-2 sm:grid-cols-2">
   <select className={input+" sm:col-span-2"} required value={form.invoiceId} onChange={e=>setForm(v=>({...v,invoiceId:e.target.value}))}><option value="">Choose an issued source invoice</option>{invoices.map(x=><option key={x.id} value={x.id}>{x.number} · {x.currency||currency} {x.total}</option>)}</select>
   <select className={input} value={form.frequency} onChange={e=>setForm(v=>({...v,frequency:e.target.value}))}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="daily">Daily</option></select>
   <input className={input} type="number" min="1" max="12" required value={form.interval} onChange={e=>setForm(v=>({...v,interval:e.target.value}))} aria-label="Repeat interval"/>
   <label className="text-xs text-slate-600">Next run<input className={input+" mt-1"} type="date" min={today()} required value={form.nextRun} onChange={e=>setForm(v=>({...v,nextRun:e.target.value}))}/></label>
   <label className="text-xs text-slate-600">End date (optional)<input className={input+" mt-1"} type="date" min={form.nextRun} value={form.endOn} onChange={e=>setForm(v=>({...v,endOn:e.target.value}))}/></label>
   <button className={button+" sm:col-span-2"} disabled={busy||!form.invoiceId}>Create recurring schedule</button>
  </form>
  <div className="mt-4 space-y-2"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Schedules</h3><button className={outline} disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}><RefreshCw className="mr-1 inline h-3.5 w-3.5"/>Refresh</button></div>
   {schedules.length?schedules.map(s=><div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-xs"><span><strong>{s.invoice_number}</strong> · every {s.interval_count} {s.frequency} · next {s.next_run_on} · {s.status}</span><span className="flex gap-1">{s.status==="active"?<button className={outline} disabled={busy} onClick={()=>setStatus(s.id,"paused")}>Pause</button>:s.status==="paused"?<button className={outline} disabled={busy} onClick={()=>setStatus(s.id,"active")}>Resume</button>:null}{["active","paused"].includes(s.status)&&<button className={outline} disabled={busy} onClick={()=>setStatus(s.id,"cancelled")}>Cancel</button>}</span></div>):<p className="text-xs text-slate-500">No recurring invoice schedules yet.</p>}
  </div>
  {error&&<p role="alert" className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
  {notice&&<p role="status" className="mt-3 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{notice}</p>}
 </section>;
}
