import { useCallback,useEffect,useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/api/backendClient";
import { Barcode,RefreshCw,ArrowLeftRight } from "lucide-react";
const field="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button="rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50";
const outline="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";

export default function WorkspaceSerialTraceability(){
 const {user}=useAuth();const workspaceId=user?.workspace_id;
 const [stock,setStock]=useState([]);const [warehouses,setWarehouses]=useState([]);const [invoices,setInvoices]=useState([]);const [serials,setSerials]=useState([]);
 const [form,setForm]=useState({stockId:"",warehouseId:"",batch:"",numbers:""});
 const [invoiceId,setInvoiceId]=useState("");const [targetWarehouse,setTargetWarehouse]=useState({});
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const load=useCallback(async()=>{
  if(!workspaceId)return;
  const [st,wh,inv,rows]=await Promise.all([
   supabase.from("stock").select("id,name,sku").eq("workspace_id",workspaceId).order("name"),
   supabase.from("warehouses").select("id,name,code").eq("workspace_id",workspaceId).eq("is_active",true).order("name"),
   supabase.from("invoices").select("id,number,status,is_draft").eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(100),
   supabase.rpc("main_workspace_list_inventory_serials",{p_workspace_id:workspaceId})
  ]);
  for(const x of [st,wh,inv,rows])if(x.error)throw x.error;
  if(rows.data?.ok===false)throw new Error(rows.data.reason||"Serial list unavailable.");
  setStock(st.data||[]);setWarehouses(wh.data||[]);setInvoices((inv.data||[]).filter(x=>!x.is_draft&&!["draft","cancelled","void"].includes(String(x.status).toLowerCase())));setSerials(rows.data?.serials||[]);
 },[workspaceId]);
 useEffect(()=>{load().catch(e=>setError(e.message||"Could not load serial inventory."));},[load]);
 const run=async(fn,msg)=>{setBusy(true);setError("");setNotice("");try{await fn();setNotice(msg);await load();}catch(e){setError(e.message||"Operation failed.");}finally{setBusy(false);}};
 const rpc=async(name,args)=>{const {data,error}=await supabase.rpc(name,args);if(error)throw error;if(data?.ok===false)throw new Error(data.reason||"Request rejected.");return data;};
 const register=e=>{e.preventDefault();const numbers=form.numbers.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);return run(()=>rpc("main_workspace_register_inventory_serials",{p_workspace_id:workspaceId,p_stock_id:form.stockId,p_warehouse_id:form.warehouseId,p_serial_numbers:numbers,p_batch_number:form.batch||null,p_registration_key:crypto.randomUUID()}),"Serial units registered.");};
 const change=(s,status,warehouseId=null)=>run(()=>rpc("main_workspace_update_inventory_serial",{p_workspace_id:workspaceId,p_serial_id:s.id,p_new_status:status,p_new_warehouse_id:warehouseId,p_invoice_id:status==="sold"?invoiceId:null,p_note:"Updated from serial traceability"}),"Serial unit updated.");
 if(!["admin","manager","storekeeper"].includes(user?.role))return null;
 return <section className="rounded-2xl border bg-white p-4 sm:p-5">
  <div className="flex items-center gap-2"><Barcode className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Serial-number traceability</h2></div>
  <p className="mt-1 text-xs text-slate-500">Register unique serial numbers, trace warehouse location and track in-stock, reserved, sold, returned and defective states. This is a traceability ledger and does not change aggregate stock quantity.</p>
  <form onSubmit={register} className="mt-4 space-y-2">
   <div className="grid gap-2 sm:grid-cols-2"><select className={field} required value={form.stockId} onChange={e=>setForm(v=>({...v,stockId:e.target.value}))}><option value="">Select stock item</option>{stock.map(s=><option key={s.id} value={s.id}>{s.name}{s.sku?" · "+s.sku:""}</option>)}</select><select className={field} required value={form.warehouseId} onChange={e=>setForm(v=>({...v,warehouseId:e.target.value}))}><option value="">Select warehouse</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name} · {w.code}</option>)}</select></div>
   <input className={field} placeholder="Batch / lot number (optional)" value={form.batch} onChange={e=>setForm(v=>({...v,batch:e.target.value}))}/>
   <textarea className={field} rows={4} required placeholder="One serial number per line (max 200)" value={form.numbers} onChange={e=>setForm(v=>({...v,numbers:e.target.value}))}/>
   <button className={button} disabled={busy||!form.stockId||!form.warehouseId}>Register serial numbers</button>
  </form>
  <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Serial register ({serials.length})</h3><button className={outline} disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}><RefreshCw className="mr-1 inline h-3.5 w-3.5"/>Refresh</button></div>
  <div className="mt-2 space-y-2">{serials.map(s=><article key={s.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{s.serial_number} · {s.stock_name}</p><p className="text-xs text-slate-500">{s.warehouse_name} · {s.status}{s.batch_number?" · Batch "+s.batch_number:""}</p></div><div className="flex flex-wrap gap-1">{s.status==="in_stock"&&<button className={outline} disabled={busy} onClick={()=>change(s,"reserved")}>Reserve</button>}{["in_stock","reserved"].includes(s.status)&&<button className={outline} disabled={busy||!invoiceId} onClick={()=>change(s,"sold")}>Mark sold</button>}{s.status==="sold"&&<button className={outline} disabled={busy} onClick={()=>change(s,"returned")}>Return</button>}{["in_stock","reserved","returned"].includes(s.status)&&<button className={outline} disabled={busy} onClick={()=>change(s,"defective")}>Defective</button>}{["reserved","returned","defective"].includes(s.status)&&<button className={outline} disabled={busy} onClick={()=>change(s,"in_stock")}>Back in stock</button>}</div></div>
   {["in_stock","returned"].includes(s.status)&&warehouses.length>1&&<div className="mt-2 flex gap-2"><select className={field} value={targetWarehouse[s.id]||""} onChange={e=>setTargetWarehouse(v=>({...v,[s.id]:e.target.value}))}><option value="">Move to warehouse…</option>{warehouses.filter(w=>w.id!==s.warehouse_id).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><button className={outline} disabled={busy||!targetWarehouse[s.id]} onClick={()=>change(s,null,targetWarehouse[s.id])}><ArrowLeftRight className="mr-1 inline h-3.5 w-3.5"/>Move</button></div>}
  </article>)}{!serials.length&&<p className="text-xs text-slate-500">No serial numbers registered yet.</p>}</div>
  <div className="mt-3"><label className="block text-xs text-slate-600">Issued invoice reference required to mark serial units sold<select className={field+" mt-1"} value={invoiceId} onChange={e=>setInvoiceId(e.target.value)}><option value="">Select issued invoice</option>{invoices.map(i=><option key={i.id} value={i.id}>{i.number}</option>)}</select></label></div>
  {(error||notice)&&<p role={error?"alert":"status"} className={"mt-3 rounded-lg p-2 text-xs "+(error?"bg-red-50 text-red-700":"bg-emerald-50 text-emerald-700")}>{error||notice}</p>}
 </section>;
}
