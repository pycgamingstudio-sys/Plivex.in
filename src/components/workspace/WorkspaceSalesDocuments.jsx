import { useCallback,useEffect,useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/api/backendClient";
import { ClipboardList,PackageCheck,ReceiptText,Plus,Trash2 } from "lucide-react";

const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button="rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50";
const outline="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";
const blankItem=()=>({description:"",quantity:"1",unitPrice:"0",taxRate:"0",stockId:""});

export default function WorkspaceSalesDocuments(){
 const {user}=useAuth();const workspaceId=user?.workspace_id;const currency=user?.currency_code||"";
 const [orders,setOrders]=useState([]);const [challans,setChallans]=useState([]);const [notes,setNotes]=useState([]);const [invoices,setInvoices]=useState([]);
 const [orderForm,setOrderForm]=useState({clientName:"",clientId:"",expectedDate:"",notes:"",items:[blankItem()]});
 const [challanOrder,setChallanOrder]=useState("");
 const [noteForm,setNoteForm]=useState({invoiceId:"",type:"credit",reason:"",amount:""});
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const [orderKey,setOrderKey]=useState(()=>crypto.randomUUID());const [noteKey,setNoteKey]=useState(()=>crypto.randomUUID());const [challanKeys,setChallanKeys]=useState({});
 const load=useCallback(async()=>{
  if(!workspaceId)return;
  const [docs,inv]=await Promise.all([
   supabase.rpc("main_workspace_list_sales_documents",{p_workspace_id:workspaceId}),
   supabase.from("invoices").select("id,number,status,total,currency,is_draft").eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(100)
  ]);
  if(docs.error)throw docs.error;if(docs.data?.ok===false)throw new Error(docs.data.reason||"Sales documents unavailable.");if(inv.error)throw inv.error;
  setOrders(docs.data.sales_orders||[]);setChallans(docs.data.delivery_challans||[]);setNotes(docs.data.credit_debit_notes||[]);
  setInvoices((inv.data||[]).filter(x=>!x.is_draft&&!["draft","cancelled","void"].includes(String(x.status).toLowerCase())));
 },[workspaceId]);
 useEffect(()=>{load().catch(e=>setError(e.message||"Could not load sales documents."));},[load]);
 const run=async(fn,message)=>{setBusy(true);setError("");setNotice("");try{await fn();setNotice(message);await load();return true;}catch(e){setError(e.message||"Operation failed.");return false;}finally{setBusy(false);}};
 const rpc=async(name,args)=>{const {data,error}=await supabase.rpc(name,args);if(error)throw error;if(data?.ok===false)throw new Error(data.reason||"Request rejected.");return data;};
 const createOrder=async e=>{e.preventDefault();const ok=await run(()=>rpc("main_workspace_create_sales_order",{p_workspace_id:workspaceId,p_client_id:orderForm.clientId||null,p_client_name:orderForm.clientName,p_items:orderForm.items.map(i=>({description:i.description,quantity:Number(i.quantity),unit_price:Number(i.unitPrice),tax_rate:Number(i.taxRate),stock_id:i.stockId||null})),p_expected_date:orderForm.expectedDate||null,p_notes:orderForm.notes||null,p_idempotency_key:orderKey}),"Sales order created as a draft.");if(ok)setOrderKey(crypto.randomUUID());};
 const createChallan=async(order)=>{const remaining=(order.items||[]).filter(i=>Number(i.quantity)>Number(i.delivered_quantity||0)).map(i=>({sales_order_item_id:i.id,quantity:Number(i.quantity)-Number(i.delivered_quantity||0)}));if(!remaining.length){setError("All order quantities have already been dispatched.");return;}const key=challanKeys[order.id]||crypto.randomUUID();const ok=await run(()=>rpc("main_workspace_create_delivery_challan",{p_workspace_id:workspaceId,p_sales_order_id:order.id,p_items:remaining,p_idempotency_key:key,p_notes:""}),"Delivery challan created. Dispatch it to start fulfilment.");if(ok)setChallanKeys(v=>({...v,[order.id]:crypto.randomUUID()}));};
 const status=(type,id,next,message)=>run(()=>rpc("main_workspace_set_sales_document_status",{p_workspace_id:workspaceId,p_document_type:type,p_document_id:id,p_status:next}),message);
 const createNote=async e=>{e.preventDefault();const ok=await run(()=>rpc("main_workspace_create_credit_debit_note",{p_workspace_id:workspaceId,p_invoice_id:noteForm.invoiceId,p_note_type:noteForm.type,p_reason:noteForm.reason,p_amount:Number(noteForm.amount),p_idempotency_key:noteKey}),"Credit/debit note draft created.");if(ok)setNoteKey(crypto.randomUUID());};
 const addItem=()=>setOrderForm(v=>({...v,items:[...v.items,blankItem()]}));
 const setItem=(idx,key,value)=>setOrderForm(v=>({...v,items:v.items.map((item,i)=>i===idx?{...item,[key]:value}:item)}));
 if(!["admin","manager","accountant","storekeeper"].includes(user?.role))return null;
 return <div className="space-y-5">
  <section className="rounded-2xl border bg-white p-4 sm:p-5">
   <div className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Sales orders</h2></div>
   <p className="mt-1 text-xs text-slate-500">Workspace-currency sales orders with item-level tax and idempotent creation. Orders do not post accounting entries automatically.</p>
   <form onSubmit={createOrder} className="mt-4 space-y-3">
    <div className="grid gap-2 sm:grid-cols-2"><input className={input} required placeholder="Customer / client name" value={orderForm.clientName} onChange={e=>setOrderForm(v=>({...v,clientName:e.target.value}))}/><input className={input} type="date" value={orderForm.expectedDate} onChange={e=>setOrderForm(v=>({...v,expectedDate:e.target.value}))}/></div>
    {orderForm.items.map((item,i)=><div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-5"><input className={input+" sm:col-span-2"} required placeholder="Item description" value={item.description} onChange={e=>setItem(i,"description",e.target.value)}/><input className={input} type="number" min="0.0001" step="0.0001" required placeholder="Qty" value={item.quantity} onChange={e=>setItem(i,"quantity",e.target.value)}/><input className={input} type="number" min="0" step="0.01" required placeholder={"Unit price ("+currency+")"} value={item.unitPrice} onChange={e=>setItem(i,"unitPrice",e.target.value)}/><div className="flex gap-2"><input className={input} type="number" min="0" max="100" step="0.01" placeholder="Tax %" value={item.taxRate} onChange={e=>setItem(i,"taxRate",e.target.value)}/>{orderForm.items.length>1&&<button type="button" className={outline} onClick={()=>setOrderForm(v=>({...v,items:v.items.filter((_,j)=>j!==i)}))} aria-label="Remove item"><Trash2 className="h-4 w-4"/></button>}</div></div>)}
    <div className="flex flex-wrap gap-2"><button type="button" className={outline} onClick={addItem}><Plus className="mr-1 inline h-3.5 w-3.5"/>Add item</button><input className={input+" flex-1"} placeholder="Notes (optional)" value={orderForm.notes} onChange={e=>setOrderForm(v=>({...v,notes:e.target.value}))}/><button className={button} disabled={busy||!currency}>Create sales order</button></div>
   </form>
   <div className="mt-4 space-y-2">{orders.map(o=><article key={o.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{o.order_number} · {o.client_name}</p><p className="text-xs text-slate-500">{o.status} · {o.currency_code} {o.total} · {o.order_date}</p></div><div className="flex gap-2">{o.status==="draft"&&<button className={outline} disabled={busy} onClick={()=>status("sales_order",o.id,"confirmed","Sales order confirmed.")}>Confirm</button>}{["confirmed","partially_fulfilled"].includes(o.status)&&<button className={outline} disabled={busy} onClick={()=>createChallan(o)}>Create challan</button>}</div></div><div className="mt-2 space-y-1">{(o.items||[]).map(i=><p key={i.id} className="text-xs text-slate-600">{i.description} · {i.delivered_quantity}/{i.quantity} delivered</p>)}</div></article>)}{!orders.length&&<p className="text-xs text-slate-500">No sales orders yet.</p>}</div>
  </section>
  <section className="rounded-2xl border bg-white p-4 sm:p-5">
   <div className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Delivery challans</h2></div>
   <div className="mt-3 space-y-2">{challans.map(c=><div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2"><div><p className="text-sm font-semibold">{c.challan_number} · {c.client_name}</p><p className="text-xs text-slate-500">{c.status} · {c.dispatch_date} · {(c.items||[]).map(i=>i.description+" × "+i.quantity).join(", ")}</p></div><div className="flex gap-2">{c.status==="draft"&&<button className={outline} disabled={busy} onClick={()=>status("delivery_challan",c.id,"dispatched","Challan marked dispatched.")}>Dispatch</button>}{c.status==="dispatched"&&<button className={outline} disabled={busy} onClick={()=>status("delivery_challan",c.id,"received","Delivery receipt recorded.")}>Mark received</button>}</div></div>)}{!challans.length&&<p className="text-xs text-slate-500">No delivery challans yet.</p>}</div>
  </section>
  <section className="rounded-2xl border bg-white p-4 sm:p-5">
   <div className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Credit & debit notes</h2></div>
   <p className="mt-1 text-xs text-slate-500">Credit notes are capped at the remaining issued invoice total. Issuing a note records its lifecycle; it does not silently post a journal entry or submit a government return.</p>
   <form onSubmit={createNote} className="mt-3 grid gap-2 sm:grid-cols-2">
    <select className={input+" sm:col-span-2"} required value={noteForm.invoiceId} onChange={e=>setNoteForm(v=>({...v,invoiceId:e.target.value}))}><option value="">Select an issued invoice</option>{invoices.map(i=><option key={i.id} value={i.id}>{i.number} · {i.currency} {i.total}</option>)}</select>
    <select className={input} value={noteForm.type} onChange={e=>setNoteForm(v=>({...v,type:e.target.value}))}><option value="credit">Credit note</option><option value="debit">Debit note</option></select>
    <input className={input} required type="number" min="0.01" step="0.01" placeholder="Note amount" value={noteForm.amount} onChange={e=>setNoteForm(v=>({...v,amount:e.target.value}))}/>
    <input className={input+" sm:col-span-2"} required minLength={3} maxLength={1000} placeholder="Reason" value={noteForm.reason} onChange={e=>setNoteForm(v=>({...v,reason:e.target.value}))}/>
    <button className={button+" sm:col-span-2"} disabled={busy||!noteForm.invoiceId}>Create note draft</button>
   </form>
   <div className="mt-4 space-y-2">{notes.map(n=><div key={n.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-xs"><span>{n.note_number} · {n.note_type} · Invoice {n.invoice_number} · {n.currency_code} {n.amount} · {n.status}</span>{n.status==="draft"&&<button className={outline} disabled={busy} onClick={()=>status("credit_debit_note",n.id,"issued","Note issued and audit recorded.")}>Issue note</button>}</div>)}{!notes.length&&<p className="text-xs text-slate-500">No credit/debit notes yet.</p>}</div>
  </section>
  {(error||notice)&&<p role={error?"alert":"status"} className={"rounded-lg p-3 text-sm "+(error?"bg-red-50 text-red-700":"bg-emerald-50 text-emerald-800")}>{error||notice}</p>}
 </div>;
}
