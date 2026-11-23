import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/api/backendClient";
import { RefreshCw, ShieldCheck, Workflow, UserRoundCog } from "lucide-react";

const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button="rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const outline="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";
const ROLES=["admin","manager","accountant","employee","storekeeper"];
const PERMISSIONS=["approval.request","approval.decide","approval.read","audit.read","export.request","fx.convert","branch.read","invoice.read","invoice.create"];

export default function WorkspaceEnterpriseControls(){
 const {user}=useAuth(); const workspaceId=user?.workspace_id; const currency=user?.currency_code||"";
 const [members,setMembers]=useState([]); const [requests,setRequests]=useState([]); const [delegations,setDelegations]=useState([]);
 const [policy,setPolicy]=useState({action:"expense.create",minimum:"0",levels:["manager","admin"],hours:"24",escalation:"admin"});
 const [request,setRequest]=useState({action:"expense.create",entity:"expense",entityId:"",amount:"",currency});
 const [delegate,setDelegate]=useState({memberId:"",permissions:["approval.request","approval.read"],days:"7"});
 const [override,setOverride]=useState({target:"role:employee",permission:"invoice.create",effect:"deny"});
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const load=useCallback(async()=>{
  if(!workspaceId)return;
  const [m,a,d]=await Promise.all([
   supabase.from("workspace_members").select("id,user_id,name,email,role,status").eq("workspace_id",workspaceId).eq("status","active").order("name"),
   supabase.rpc("main_workspace_list_approval_requests",{p_workspace_id:workspaceId}),
   supabase.rpc("main_workspace_permission_delegation_list",{p_workspace_id:workspaceId})
  ]);
  if(m.error)throw m.error;if(a.error)throw a.error;if(d.error)throw d.error;
  if(a.data?.ok===false)throw new Error(a.data.reason||"Approval queue unavailable.");
  if(d.data?.ok===false)throw new Error(d.data.reason||"Delegation list unavailable.");
  setMembers(m.data||[]);setRequests(a.data?.requests||[]);setDelegations(d.data?.delegations||[]);
 },[workspaceId]);
 useEffect(()=>{load().catch(e=>setError(e.message||"Could not load enterprise controls."));},[load]);
 const run=async(fn,message)=>{setBusy(true);setError("");setNotice("");try{await fn();setNotice(message);await load();}catch(e){setError(e.message||"Operation failed.");}finally{setBusy(false);}};
 const rpc=async(name,args)=>{const {data,error}=await supabase.rpc(name,args);if(error)throw error;if(data?.ok===false)throw new Error(data.reason||"Operation was rejected.");return data;};
 const savePolicy=e=>{e.preventDefault();run(()=>rpc("main_workspace_set_approval_policy",{p_workspace_id:workspaceId,p_action_type:policy.action,p_enabled:true,p_minimum_amount:Number(policy.minimum),p_currency_code:currency,p_approval_levels:policy.levels,p_escalation_after_hours:Number(policy.hours),p_escalation_role:policy.escalation}),"Sequential approval policy saved.");};
 const submitRequest=e=>{e.preventDefault();run(()=>rpc("main_workspace_request_approval",{p_workspace_id:workspaceId,p_action_type:request.action,p_entity_type:request.entity,p_entity_id:request.entityId||null,p_amount:Number(request.amount),p_currency_code:currency,p_payload:{source:"workspace_enterprise_controls"}}),"Approval request submitted.");};
 const decide=(id,decision)=>run(()=>rpc("main_workspace_decide_approval",{p_workspace_id:workspaceId,p_request_id:id,p_decision:decision,p_note:""}),decision==="approve"?"Approval step completed.":"Request rejected.");
 const cancel=id=>run(()=>rpc("main_workspace_cancel_approval",{p_workspace_id:workspaceId,p_request_id:id}),"Approval request cancelled.");
 const toggle=(key)=>setDelegate(v=>({...v,permissions:v.permissions.includes(key)?v.permissions.filter(x=>x!==key):[...v.permissions,key]}));
 const createDelegation=e=>{e.preventDefault();run(()=>rpc("main_workspace_permission_delegation_create",{p_workspace_id:workspaceId,p_delegate_member_id:delegate.memberId,p_permission_keys:delegate.permissions,p_expires_at:new Date(Date.now()+Number(delegate.days)*86400000).toISOString()}),"Temporary permission delegation created.");};
 const revoke=id=>run(()=>rpc("main_workspace_permission_delegation_revoke",{p_workspace_id:workspaceId,p_delegation_id:id}),"Delegation revoked.");
 const saveOverride=e=>{e.preventDefault();const [kind,value]=override.target.split(":");return run(()=>rpc("main_workspace_permission_override_set",{p_workspace_id:workspaceId,p_member_id:kind==="member"?value:null,p_role:kind==="role"?value:null,p_permission_key:override.permission,p_effect:override.effect}),"Permission override saved.");};
 return <div className="space-y-5">
  <section className="rounded-2xl border bg-white p-4 sm:p-5">
   <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Workflow className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Multi-level approvals</h2></div><button className={outline} disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}><RefreshCw className="mr-1 inline h-3.5 w-3.5"/>Refresh</button></div>
   <p className="mt-1 text-xs text-slate-500">Configure up to five sequential approval roles. Self-approval is blocked; overdue active steps escalate automatically every five minutes.</p>
   <form onSubmit={savePolicy} className="mt-4 grid gap-2 sm:grid-cols-2">
    <select className={input} value={policy.action} onChange={e=>setPolicy(v=>({...v,action:e.target.value}))}><option value="expense.create">Expense creation</option><option value="expense.update">Expense update</option><option value="invoice.issue">Invoice issue</option><option value="invoice.payment.record">Invoice payment record</option></select>
    <input className={input} type="number" min="0" step="0.01" required placeholder="Minimum amount" value={policy.minimum} onChange={e=>setPolicy(v=>({...v,minimum:e.target.value}))}/>
    <div className="sm:col-span-2"><p className="mb-1 text-xs font-semibold">Approval sequence (drag-free role order)</p><div className="flex flex-wrap gap-2">{ROLES.map(role=><label key={role} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={policy.levels.includes(role)} onChange={()=>setPolicy(v=>({...v,levels:v.levels.includes(role)?v.levels.filter(x=>x!==role):[...v.levels,role].slice(0,5)}))}/>{role}</label>)}</div></div>
    <input className={input} type="number" min="1" max="720" value={policy.hours} onChange={e=>setPolicy(v=>({...v,hours:e.target.value}))} aria-label="Escalation hours"/>
    <select className={input} value={policy.escalation} onChange={e=>setPolicy(v=>({...v,escalation:e.target.value}))}><option value="admin">Escalate to admin</option><option value="manager">Escalate to manager</option><option value="accountant">Escalate to accountant</option></select>
    <button className={button+" sm:col-span-2"} disabled={busy||!policy.levels.length}>Save approval policy · {currency}</button>
   </form>
   <form onSubmit={submitRequest} className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-2">
    <p className="text-sm font-semibold sm:col-span-2">Submit an approval request</p>
    <select className={input} value={request.action} onChange={e=>setRequest(v=>({...v,action:e.target.value}))}><option value="expense.create">Expense creation</option><option value="expense.update">Expense update</option><option value="invoice.issue">Invoice issue</option><option value="invoice.payment.record">Invoice payment record</option></select>
    <input className={input} required type="number" min="0" step="0.01" placeholder={"Amount ("+currency+")"} value={request.amount} onChange={e=>setRequest(v=>({...v,amount:e.target.value}))}/>
    <input className={input} required placeholder="Record type (e.g. expense)" value={request.entity} onChange={e=>setRequest(v=>({...v,entity:e.target.value}))}/>
    <input className={input} placeholder="Record ID (optional)" value={request.entityId} onChange={e=>setRequest(v=>({...v,entityId:e.target.value}))}/>
    <button className={button+" sm:col-span-2"} disabled={busy||!currency}>Submit for approval</button>
   </form>
   <div className="mt-4 space-y-2"><h3 className="text-sm font-semibold">Approval queue</h3>{requests.length?requests.map(r=><article key={r.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{r.action_type} · {r.amount} {r.currency_code}</p><p className="text-xs text-slate-500">{r.entity_type} {r.entity_id||""} · Level {r.current_level}/{r.approval_levels?.length||1} · {r.status}</p></div>{r.status==="pending"&&<div className="flex gap-2"><button className={outline} disabled={busy} onClick={()=>decide(r.id,"approve")}>Approve</button><button className={outline} disabled={busy} onClick={()=>decide(r.id,"reject")}>Reject</button><button className={outline} disabled={busy} onClick={()=>cancel(r.id)}>Cancel</button></div>}</div><div className="mt-2 flex flex-wrap gap-2">{(r.steps||[]).map(s=><span key={s.id} className="rounded bg-slate-100 px-2 py-1 text-[10px]">{s.level}. {s.approver_role}: {s.status}{s.escalated_at?" · escalated":""}</span>)}</div></article>):<p className="text-xs text-slate-500">No approval requests yet.</p>}</div>
  </section>
  <section className="rounded-2xl border bg-white p-4 sm:p-5">
   <div className="flex items-center gap-2"><UserRoundCog className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Enterprise permissions & delegation</h2></div>
   <p className="mt-1 text-xs text-slate-500">Delegate selected permissions to an active team member for up to 90 days. All changes are audited and can be revoked.</p>
   <form onSubmit={createDelegation} className="mt-4 space-y-3">
    <select className={input} required value={delegate.memberId} onChange={e=>setDelegate(v=>({...v,memberId:e.target.value}))}><option value="">Select active team member</option>{members.filter(m=>m.user_id!==user?.id).map(m=><option key={m.id} value={m.id}>{m.name||m.email} · {m.role}</option>)}</select>
    <div className="flex flex-wrap gap-3">{PERMISSIONS.map(p=><label key={p} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={delegate.permissions.includes(p)} onChange={()=>toggle(p)}/>{p}</label>)}</div>
    <div className="flex gap-2"><input className={input} type="number" min="1" max="90" value={delegate.days} onChange={e=>setDelegate(v=>({...v,days:e.target.value}))}/><button className={button} disabled={busy||!delegate.memberId||!delegate.permissions.length}>Delegate access</button></div>
   </form>
   <div className="mt-4 space-y-2">{delegations.length?delegations.map(d=><div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-xs"><span>{d.delegate_name||d.delegate_email} · {d.permission_keys.join(", ")} · until {new Date(d.expires_at).toLocaleDateString()}</span>{d.revoked_at?<span>Revoked</span>:<button className={outline} disabled={busy} onClick={()=>revoke(d.id)}>Revoke</button>}</div>):<p className="text-xs text-slate-500">No active delegations.</p>}</div>
   <form onSubmit={saveOverride} className="mt-5 space-y-2 border-t pt-4">
    <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-violet-700"/><h3 className="text-sm font-semibold">Permission override</h3></div>
    <select className={input} value={override.target} onChange={e=>setOverride(v=>({...v,target:e.target.value}))}><optgroup label="Roles">{ROLES.map(r=><option key={r} value={"role:"+r}>{r} role</option>)}</optgroup><optgroup label="Members">{members.map(m=><option key={m.id} value={"member:"+m.id}>{m.name||m.email}</option>)}</optgroup></select>
    <div className="grid gap-2 sm:grid-cols-2"><select className={input} value={override.permission} onChange={e=>setOverride(v=>({...v,permission:e.target.value}))}>{PERMISSIONS.map(p=><option key={p} value={p}>{p}</option>)}</select><select className={input} value={override.effect} onChange={e=>setOverride(v=>({...v,effect:e.target.value}))}><option value="allow">Allow</option><option value="deny">Deny</option></select></div>
    <button className={outline} disabled={busy}>Save permission override</button>
   </form>
  </section>
  {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
 </div>;
}
