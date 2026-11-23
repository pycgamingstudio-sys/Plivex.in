import { useCallback,useEffect,useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/api/backendClient";
import { Copy,RefreshCw,Truck,UserPlus } from "lucide-react";
const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button="rounded-lg bg-violet-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50";
const outline="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";

export default function WorkspaceSupplierPortal(){
 const {user}=useAuth();const [suppliers,setSuppliers]=useState([]);const [name,setName]=useState("");const [email,setEmail]=useState("");const [inviteUrl,setInviteUrl]=useState("");const [provider,setProvider]=useState("");
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const invoke=useCallback(async(body)=>{const {data,error}=await supabase.functions.invoke("workspace-supplier-portal",{body});if(error)throw error;if(data?.ok===false)throw new Error(data.error||"Supplier portal request failed.");return data;},[]);
 const load=useCallback(async()=>{const d=await invoke({action:"invite.list"});setSuppliers(d.suppliers||[]);},[invoke]);
 useEffect(()=>{if(["admin","manager"].includes(user?.role))load().catch(e=>setError(e.message));},[load,user?.role]);
 const run=async(fn,msg)=>{setBusy(true);setError("");setNotice("");try{await fn();setNotice(msg);await load();}catch(e){setError(e.message||"Operation failed.");}finally{setBusy(false);}};
 const create=e=>{e.preventDefault();return run(async()=>{const d=await invoke({action:"invite.create",supplierName:name,email});setInviteUrl(d.inviteUrl);setProvider(d.emailProvider);setName("");setEmail("");},"Supplier invitation created.");};
 if(!["admin","manager"].includes(user?.role))return null;
 return <section className="rounded-2xl border bg-white p-4 sm:p-5">
  <div className="flex items-center gap-2"><Truck className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Supplier onboarding portal</h2></div>
  <p className="mt-1 text-xs text-slate-500">Invite suppliers to submit tax identity, contact, address and payment terms. Links are single-use and expire after seven days. Brevo is tried first, then Resend, then a copyable link.</p>
  <form onSubmit={create} className="mt-4 grid gap-2 sm:grid-cols-2"><input className={input} required minLength={2} maxLength={200} placeholder="Supplier / company name" value={name} onChange={e=>setName(e.target.value)}/><input className={input} required type="email" placeholder="Supplier email" value={email} onChange={e=>setEmail(e.target.value)}/><button className={button+" sm:col-span-2"} disabled={busy}><UserPlus className="mr-1 inline h-3.5 w-3.5"/>Create invitation</button></form>
  {inviteUrl&&<div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3"><p className="text-xs font-semibold">Invitation link · email provider: {provider}</p><code className="mt-1 block break-all text-xs">{inviteUrl}</code><button type="button" className={outline+" mt-2"} onClick={()=>navigator.clipboard.writeText(inviteUrl)}><Copy className="mr-1 inline h-3.5 w-3.5"/>Copy link</button></div>}
  <div className="mt-4 flex items-center justify-between"><h3 className="text-sm font-semibold">Supplier records</h3><button className={outline} disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}><RefreshCw className="mr-1 inline h-3.5 w-3.5"/>Refresh</button></div>
  <div className="mt-2 space-y-2">{suppliers.map(s=><article key={s.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{s.supplier_name}</p><p className="text-xs text-slate-500">{s.contact_email} · {s.status}</p>{s.tax_id&&<p className="mt-1 text-xs text-slate-500">Tax ID: {s.tax_id} · {s.tax_country_code}</p>}</div><div className="flex gap-2">{s.status==="submitted"&&<><button className={outline} disabled={busy} onClick={()=>run(()=>invoke({action:"supplier.review",supplierId:s.id,status:"approved"}),"Supplier approved.")}>Approve</button><button className={outline} disabled={busy} onClick={()=>run(()=>invoke({action:"supplier.review",supplierId:s.id,status:"rejected"}),"Supplier rejected.")}>Reject</button></>}{s.status==="invited"&&<button className={outline} disabled={busy} onClick={()=>run(()=>invoke({action:"invite.revoke",supplierId:s.id}),"Supplier invite revoked.")}>Revoke invite</button>}</div></div>{s.address&&Object.values(s.address).some(Boolean)&&<p className="mt-2 text-xs text-slate-500">{Object.values(s.address).filter(Boolean).join(", ")}</p>}{s.payment_terms&&<p className="mt-1 text-xs text-slate-500">Payment terms: {s.payment_terms}</p>}{s.review_note&&<p className="mt-1 text-xs text-slate-500">Review note: {s.review_note}</p>}</article>)}{!suppliers.length&&<p className="text-xs text-slate-500">No supplier invitations yet.</p>}</div>
  {(error||notice)&&<p role={error?"alert":"status"} className={"mt-3 rounded-lg p-2 text-xs "+(error?"bg-red-50 text-red-700":"bg-emerald-50 text-emerald-700")}>{error||notice}</p>}
 </section>;
}
