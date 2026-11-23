import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/api/backendClient";
import { Copy, FileSignature, KeyRound, MessageCircle, ScanText, RefreshCw, ShieldCheck, Search, Landmark, Boxes, Workflow, Users, ArrowRight } from "lucide-react";
import WorkspaceEnterpriseControls from "@/components/workspace/WorkspaceEnterpriseControls";
import WorkspaceRecurringInvoices from "@/components/workspace/WorkspaceRecurringInvoices";
import WorkspaceSalesDocuments from "@/components/workspace/WorkspaceSalesDocuments";
import WorkspaceSupplierPortal from "@/components/workspace/WorkspaceSupplierPortal";
import WorkspaceSerialTraceability from "@/components/workspace/WorkspaceSerialTraceability";
import WorkspaceAnalyticsPanel from "@/components/workspace/WorkspaceAnalyticsPanel";
import WorkspaceBankAccounting from "@/components/workspace/WorkspaceBankAccounting";
import WorkspaceGSTCompliance from "@/components/workspace/WorkspaceGSTCompliance";

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const primary = "rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";
const toBase64 = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary);
};

export default function WorkspacePlatformPage() {
  const { user } = useAuth();
  const workspaceId = user?.workspace_id;
  const [invoices,setInvoices] = useState([]);
  const [invoiceId,setInvoiceId] = useState("");
  const [signerName,setSignerName] = useState("");
  const [signerEmail,setSignerEmail] = useState("");
  const [signatureLink,setSignatureLink] = useState("");
  const [signatureRequestId,setSignatureRequestId] = useState("");
  const [files,setFiles] = useState([]);
  const [ocrResults,setOcrResults] = useState([]);
  const [phone,setPhone] = useState("");
  const [messageType,setMessageType] = useState("template");
  const [templateName,setTemplateName] = useState("");
  const [templateLanguage,setTemplateLanguage] = useState("en");
  const [message,setMessage] = useState("");
  const [customerInitiatedAt,setCustomerInitiatedAt] = useState("");
  const [consentStatement,setConsentStatement] = useState("");
  const [consent,setConsent] = useState(false);
  const [whatsappLogs,setWhatsappLogs] = useState([]);
  const [apiLabel,setApiLabel] = useState("");
  const [apiScopes,setApiScopes] = useState(["workspace.read","invoices.read","clients.read","mcp.read"]);
  const [apiKeys,setApiKeys] = useState([]);
  const [newSecret,setNewSecret] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [activeGroup,setActiveGroup] = useState("integrations");
  const [search,setSearch] = useState("");

  const invoke = useCallback(async (body) => {
    const {data,error:invokeError}=await supabase.functions.invoke("workspace-platform",{body});
    if(invokeError) {
      let message=invokeError.message;
      try { message=(await invokeError.context.clone().json()).error||message; } catch { /* keep SDK message */ }
      throw new Error(message);
    }
    if(data?.ok===false) throw new Error(data.error||"Operation failed.");
    return data;
  },[]);

  const refresh = useCallback(async () => {
    if(!workspaceId) return;
    const [{data:invoiceRows,error:invoiceError},{data:keyRows,error:keyError}] = await Promise.all([
      supabase.from("invoices").select("id,number,status,total,currency,issue_date,due_date").eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(100),
      invoke({action:"api-key.list"}).then(v=>({data:v.keys||[],error:null})).catch(e=>({data:[],error:e}))
    ]);
    if(invoiceError) throw invoiceError;
    if(keyError) throw keyError;
    setInvoices(invoiceRows||[]);
    setApiKeys(keyRows||[]);
    try { const w=await invoke({action:"whatsapp.list"}); setWhatsappLogs(w.messages||[]); } catch { setWhatsappLogs([]); }
  },[workspaceId,invoke]);

  useEffect(()=>{refresh().catch(e=>setError(e.message||"Could not load platform settings."));},[refresh]);

  const run = async (fn,success) => {
    setBusy(true);setError("");setNotice("");
    try { const result=await fn(); if(success)setNotice(success); await refresh(); return result; }
    catch(e){setError(e.message||"The operation could not be completed.");return null;}
    finally{setBusy(false);}
  };

  const createSignature = (e) => {
    e.preventDefault();
    return run(async()=>{const result=await invoke({action:"signature.create",invoiceId,signerName,signerEmail,expiryDays:14});setSignatureLink(result.signUrl);setSignatureRequestId(result.request?.id||"");return result;},"Secure signing link created. Share it with the named signer.");
  };
  const runOcr = () => run(async()=>{
    if(!files.length||files.length>10) throw new Error("Choose between 1 and 10 documents.");
    const results=[];
    for(const file of files){
      if(file.size>4*1024*1024) throw new Error(file.name+" exceeds the 4 MB file limit.");
      const data=await invoke({action:"ocr.process",documentType:"other",mimeType:file.type,fileBase64:await toBase64(file)});
      results.push({name:file.name,...data});
    }
    setOcrResults(results);return results;
  },"OCR extraction complete. Review every field before using it.");
  const sendWhatsapp = (e) => {
    e.preventDefault();
    return run(async()=>invoke({action:"whatsapp.send",recipientPhone:phone,messageType,templateName,templateLanguage,message,customerInitiatedAt,consentConfirmed:consent,consentStatement}),"WhatsApp request submitted. Check delivery status for the final result.");
  };
  const createKey = (e) => {
    e.preventDefault();
    return run(async()=>{const result=await invoke({action:"api-key.create",label:apiLabel,scopes:apiScopes,expiryDays:90});setNewSecret(result.secret);setApiLabel("");return result;},"API key created. Copy and store the secret now; it will not be shown again.");
  };
  const toggleScope = (scope) => setApiScopes(current=>current.includes(scope)?current.filter(x=>x!==scope):[...current,scope]);
  const scopes=["workspace.read","invoices.read","clients.read","expenses.read","leads.read","inventory.read","suppliers.read","mcp.read"];
  const isAdmin = ["admin","manager"].includes(user?.role);
  const mcpUrl = useMemo(()=>((import.meta.env.VITE_SUPABASE_URL||"").replace(/\/$/,"")+"/functions/v1/workspace-platform"),[]);

  if(!isAdmin) return <section className="rounded-2xl border bg-white p-6"><h1 className="text-xl font-bold">Platform integrations</h1><p className="mt-2 text-sm text-slate-600">Only Workspace administrators and managers can manage integrations.</p></section>;

  return <div className="plivex-tools-center space-y-5">
     <header className="overflow-hidden rounded-3xl border border-violet-100 bg-gradient-to-br from-white via-[#FBFAFF] to-violet-50/80 shadow-[0_12px_36px_rgba(54,31,92,.07)]">
       <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-7">
         <div className="min-w-0">
           <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-700">Plivex business tools</p>
           <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Business tools center</h1>
           <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">All advanced workspace tools, organised by the job they help you complete. Choose a section to see its tools and actions.</p>
         </div>
         <button type="button" className={secondary+" inline-flex items-center gap-2"} disabled={busy} onClick={()=>refresh().catch(e=>setError(e.message))}><RefreshCw className="h-4 w-4"/>Refresh data</button>
       </div>
       <div className="border-t border-violet-100/80 bg-white/80 px-5 py-3 sm:px-7">
         <label className="flex max-w-xl items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
           <Search className="h-4 w-4 shrink-0 text-slate-400"/>
           <input aria-label="Search business tool categories" className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-slate-400 focus:ring-0" placeholder="Find a tool category…" value={search} onChange={e=>setSearch(e.target.value)}/>
         </label>
       </div>
     </header>
     {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
     {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
     <section aria-label="Business tool categories" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
       {[
         {id:"integrations",title:"Connected apps",description:"Electronic signatures, document OCR, WhatsApp Cloud, Public API and MCP.",detail:"4 tools",Icon:ShieldCheck},
         {id:"finance",title:"Finance & tax",description:"GST return preparation, bank reconciliation, journals, reports and cash flow.",detail:"3 workspaces",Icon:Landmark},
         {id:"inventory",title:"Inventory traceability",description:"Serial numbers, warehouse locations, batch references and item lifecycle.",detail:"Serial register",Icon:Boxes},
         {id:"operations",title:"Sales & suppliers",description:"Sales orders, delivery challans, credit/debit notes, recurring invoices and supplier onboarding.",detail:"3 workflows",Icon:Workflow},
         {id:"security",title:"Team & approvals",description:"Approval policies, approval requests and time-bound delegated permissions.",detail:"Access controls",Icon:Users},
       ].filter(group=>(group.title+" "+group.description).toLowerCase().includes(search.trim().toLowerCase())).map(group=>{
         const selected=activeGroup===group.id;
         return <button key={group.id} type="button" aria-pressed={selected} onClick={()=>setActiveGroup(group.id)} className={`group flex min-h-[142px] items-start gap-3 rounded-2xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:p-5 ${selected?"border-violet-300 bg-violet-50/70 shadow-[0_8px_24px_rgba(109,40,217,.10)]":"border-slate-200 bg-white hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-[0_8px_24px_rgba(30,20,60,.07)]"}`}>
           <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${selected?"bg-violet-700 text-white":"bg-violet-50 text-violet-700"}`}><group.Icon className="h-5 w-5"/></span>
           <span className="min-w-0 flex-1">
             <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">{group.title}{selected&&<span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-800">Selected</span>}</span>
             <span className="mt-1.5 block text-xs leading-5 text-slate-600">{group.description}</span>
             <span className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-violet-700">{group.detail}<ArrowRight className="h-3 w-3"/></span>
           </span>
         </button>;
       })}
     </section>
     {search.trim()&&![
       "Connected apps Electronic signatures, document OCR, WhatsApp Cloud, Public API and MCP.",
       "Finance & tax GST return preparation, bank reconciliation, journals, reports and cash flow.",
       "Inventory traceability Serial numbers, warehouse locations, batch references and item lifecycle.",
       "Sales & suppliers Sales orders, delivery challans, credit/debit notes, recurring invoices and supplier onboarding.",
       "Team & approvals Approval policies, approval requests and time-bound delegated permissions."
     ].some(label=>label.toLowerCase().includes(search.trim().toLowerCase()))&&<p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">No matching category. Try a shorter search.</p>}
     <section className="space-y-4">
       <div className="flex flex-wrap items-end justify-between gap-2">
         <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700">Selected workspace</p><h2 className="mt-1 text-lg font-bold text-slate-950">{({integrations:"Connected apps",finance:"Finance & tax",inventory:"Inventory traceability",operations:"Sales & suppliers",security:"Team & approvals"})[activeGroup]}</h2></div>
         <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold text-slate-500">Changes are saved to this workspace</span>
       </div>
       {activeGroup==="integrations"&&<div className="space-y-4"><section className="rounded-2xl border bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2"><FileSignature className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Electronic signature audit</h2></div>
      <p className="mt-1 text-xs text-slate-500">Creates a one-time, expiring signing link and immutable consent/audit record. This is not a qualified eIDAS, Aadhaar eSign or government-certified signature.</p>
      <form onSubmit={createSignature} className="mt-4 grid gap-2 sm:grid-cols-2">
        <select className={field+" sm:col-span-2"} required value={invoiceId} onChange={e=>setInvoiceId(e.target.value)}><option value="">Select an issued invoice</option>{invoices.filter(x=>!["draft","cancelled","void"].includes(String(x.status).toLowerCase())).map(x=><option key={x.id} value={x.id}>{x.number} · {x.status} · {x.currency} {x.total}</option>)}</select>
        <input className={field} required minLength={2} maxLength={160} placeholder="Signer full name" value={signerName} onChange={e=>setSignerName(e.target.value)}/>
        <input className={field} required type="email" placeholder="Signer email" value={signerEmail} onChange={e=>setSignerEmail(e.target.value)}/>
        <button className={primary+" sm:col-span-2"} disabled={busy||!invoiceId}>Create signing link</button>
      </form>
      {signatureLink&&<div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3"><p className="text-xs font-semibold">One-time signing link</p><code className="mt-1 block break-all text-xs">{signatureLink}</code><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={secondary} onClick={()=>navigator.clipboard.writeText(signatureLink)}><Copy className="mr-1 inline h-3.5 w-3.5"/>Copy link</button><button type="button" className={secondary} disabled={busy||!signatureRequestId} onClick={()=>run(()=>invoke({action:"signature.revoke",requestId:signatureRequestId}),"Signing link revoked.")}>Revoke link</button></div></div>}
    </section>
    <section className="rounded-2xl border bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2"><ScanText className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Document OCR & AI extraction</h2></div>
      <p className="mt-1 text-xs text-slate-500">Upload up to 10 JPEG, PNG, WebP or PDF files (4 MB each). Gemini returns review-only draft data; no accounting records are posted automatically.</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input className={field} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>{setFiles(Array.from(e.target.files||[]));setOcrResults([]);}}/><button type="button" className={primary} disabled={busy||!files.length||files.length>10} onClick={runOcr}>Extract {files.length||""} document(s)</button></div>
      {ocrResults.map(r=><article key={r.jobId} className="mt-3 rounded-lg border p-3"><p className="text-sm font-semibold">{r.name}</p><pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(r.extracted,null,2)}</pre></article>)}
    </section>
    <section className="rounded-2xl border bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">WhatsApp Cloud messaging</h2></div>
      <p className="mt-1 text-xs text-slate-500">Requires Meta WhatsApp Cloud credentials in Supabase secrets, an approved template outside the 24-hour customer-service window, and recorded opt-in evidence.</p>
      <form onSubmit={sendWhatsapp} className="mt-4 grid gap-2 sm:grid-cols-2">
        <input className={field} required placeholder="Recipient phone (+country code)" value={phone} onChange={e=>setPhone(e.target.value)}/>
        <select className={field} value={messageType} onChange={e=>setMessageType(e.target.value)}><option value="template">Approved template</option><option value="text">Free-form (24-hour window)</option></select>
        {messageType==="template"?<><input className={field} required placeholder="Approved Meta template name" value={templateName} onChange={e=>setTemplateName(e.target.value)}/><input className={field} placeholder="Template language (en)" value={templateLanguage} onChange={e=>setTemplateLanguage(e.target.value)}/></>:<><textarea className={field} required maxLength={4000} placeholder="Message" value={message} onChange={e=>setMessage(e.target.value)}/><input className={field} required type="datetime-local" value={customerInitiatedAt} onChange={e=>setCustomerInitiatedAt(e.target.value)}/></>}
        <input className={field+" sm:col-span-2"} required minLength={10} maxLength={500} placeholder="Customer opt-in evidence" value={consentStatement} onChange={e=>setConsentStatement(e.target.value)}/>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/>Customer has explicitly opted in to receive WhatsApp messages.</label>
        <button className={primary+" sm:col-span-2"} disabled={busy||!consent}>Send WhatsApp message</button>
      </form>
      <div className="mt-4"><h3 className="text-sm font-semibold">Recent delivery statuses</h3>{whatsappLogs.length?whatsappLogs.map(x=><p key={x.id} className="border-t py-2 text-xs">{x.recipient_phone} · {x.message_type} · {x.status} · {new Date(x.created_at).toLocaleString()}</p>):<p className="mt-2 text-xs text-slate-500">No messages recorded yet.</p>}</div>
    </section>
    <section className="rounded-2xl border bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Public API & MCP access</h2></div>
      <p className="mt-1 text-xs text-slate-500">Scoped, hashed, revocable and expiring keys. The secret is displayed once; keep it on a trusted server, never in browser code.</p>
      <form onSubmit={createKey} className="mt-4 space-y-3"><input className={field} required minLength={2} maxLength={80} placeholder="API key label" value={apiLabel} onChange={e=>setApiLabel(e.target.value)}/><div className="flex flex-wrap gap-3 text-xs">{scopes.map(s=><label key={s} className="flex items-center gap-1"><input type="checkbox" checked={apiScopes.includes(s)} onChange={()=>toggleScope(s)}/>{s}</label>)}</div><button className={primary} disabled={busy||!apiScopes.length}>Create API key</button></form>
      {newSecret&&<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold">Copy this secret now</p><code className="mt-1 block break-all text-xs">{newSecret}</code><button className={secondary+" mt-2"} type="button" onClick={()=>navigator.clipboard.writeText(newSecret)}><Copy className="mr-1 inline h-3.5 w-3.5"/>Copy secret</button></div>}
      <div className="mt-4 space-y-2">{apiKeys.map(k=><div key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-xs"><span>{k.label} · {k.key_prefix} · expires {new Date(k.expires_at).toLocaleDateString()}</span>{k.revoked_at?<span className="text-slate-500">Revoked</span>:<button type="button" className={secondary} disabled={busy} onClick={()=>run(()=>invoke({action:"api-key.revoke",keyId:k.id}),"API key revoked.")}>Revoke</button>}</div>)}</div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs"><p className="font-semibold"><ShieldCheck className="mr-1 inline h-3.5 w-3.5"/>MCP endpoint</p><code className="mt-1 block break-all">{mcpUrl}</code><p className="mt-2">Use the Supabase publishable/anon key as apikey and your Plivex key as x-plivex-key. Available read tools: workspace_summary, list_invoices, list_clients, business_insights.</p></div>
    </section></div>}
       {activeGroup==="finance"&&<div className="space-y-4"><WorkspaceGSTCompliance/><WorkspaceBankAccounting/><WorkspaceAnalyticsPanel/></div>}
       {activeGroup==="inventory"&&<div className="space-y-4"><WorkspaceSerialTraceability/></div>}
       {activeGroup==="operations"&&<div className="space-y-4"><WorkspaceSupplierPortal/><WorkspaceSalesDocuments/><WorkspaceRecurringInvoices/></div>}
       {activeGroup==="security"&&<div className="space-y-4"><WorkspaceEnterpriseControls/></div>}
     </section>
   </div>;
}
