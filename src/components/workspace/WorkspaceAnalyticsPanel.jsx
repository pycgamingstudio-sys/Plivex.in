import { useCallback,useEffect,useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/api/backendClient";
import { BarChart3,RefreshCw,Save,Trash2 } from "lucide-react";
const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button="rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50";
const outline="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";
const METRICS=[["invoice_count","Invoice count"],["invoice_total","Invoice total"],["expense_total","Expense total"],["lead_count","Lead count"],["lead_value","Lead value"],["low_stock_count","Low-stock items"]];
const startDate=days=>{const d=new Date();d.setDate(d.getDate()-days);return d.toISOString().slice(0,10);};
export default function WorkspaceAnalyticsPanel(){
 const {user}=useAuth();const workspaceId=user?.workspace_id;
 const [reports,setReports]=useState([]);const [reportName,setReportName]=useState("");const [metrics,setMetrics]=useState(["invoice_count","invoice_total","expense_total"]);const [groupBy,setGroupBy]=useState("month");const [days,setDays]=useState("90");const [rows,setRows]=useState([]);
 const [forecast,setForecast]=useState([]);const [sales,setSales]=useState([]);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const rpc=async(name,args)=>{const {data,error}=await supabase.rpc(name,args);if(error)throw error;if(data?.ok===false)throw new Error(data.reason||"Analytics request failed.");return data;};
 const load=useCallback(async()=>{
  if(!workspaceId)return;
  const [r,c,s]=await Promise.all([
   rpc("main_workspace_list_custom_reports",{p_workspace_id:workspaceId}),
   rpc("main_workspace_cashflow_forecast",{p_workspace_id:workspaceId}),
   rpc("main_workspace_sales_analytics",{p_workspace_id:workspaceId})
  ]);
  setReports(r.reports||[]);setForecast(c.forecast||[]);setSales(s.sales||[]);
 },[workspaceId]);
 useEffect(()=>{if(["admin","manager","accountant"].includes(user?.role))load().catch(e=>setError(e.message));},[load,user?.role]);
 const toggleMetric=m=>setMetrics(v=>v.includes(m)?v.filter(x=>x!==m):[...v,m]);
 const runReport=async(config={metrics,groupBy,days:Number(days)})=>{
  const since=startDate(config.days);const [i,e,l,st]=await Promise.all([
   supabase.from("invoices").select("issue_date,total,currency,status,is_draft").eq("workspace_id",workspaceId).gte("issue_date",since).eq("is_draft",false),
   supabase.from("expenses").select("date,amount,currency_code,category,status").eq("workspace_id",workspaceId).gte("date",since),
   supabase.from("leads").select("created_at,value,currency_code,stage").eq("workspace_id",workspaceId).gte("created_at",since+"T00:00:00"),
   supabase.from("stock").select("quantity,low_stock").eq("workspace_id",workspaceId)
  ]);
  for(const x of [i,e,l,st])if(x.error)throw x.error;
  const map=new Map();const row=(group,currency="—")=>{const key=group+"||"+currency;if(!map.has(key))map.set(key,{group,currency,invoice_count:0,invoice_total:0,expense_total:0,lead_count:0,lead_value:0,low_stock_count:0});return map.get(key);};
  if(config.metrics.includes("invoice_count")||config.metrics.includes("invoice_total"))for(const x of i.data||[]){const group=config.groupBy==="month"?String(x.issue_date||"").slice(0,7):"All";const r=row(group,x.currency||"UNK");if(config.metrics.includes("invoice_count"))r.invoice_count++;if(config.metrics.includes("invoice_total"))r.invoice_total+=Number(x.total||0);}
  if(config.metrics.includes("expense_total"))for(const x of e.data||[]){const group=config.groupBy==="month"?String(x.date||"").slice(0,7):config.groupBy==="category"?(x.category||"Uncategorised"):"All";row(group,x.currency_code||"UNK").expense_total+=Number(x.amount||0);}
  if(config.metrics.includes("lead_count")||config.metrics.includes("lead_value"))for(const x of l.data||[]){const group=config.groupBy==="month"?String(x.created_at||"").slice(0,7):config.groupBy==="stage"?(x.stage||"New"):"All";const r=row(group,x.currency_code||"UNK");if(config.metrics.includes("lead_count"))r.lead_count++;if(config.metrics.includes("lead_value"))r.lead_value+=Number(x.value||0);}
  if(config.metrics.includes("low_stock_count")){const count=(st.data||[]).filter(x=>Number(x.quantity)<=Number(x.low_stock)).length;row("All","—").low_stock_count=count;}
  setRows([...map.values()].sort((a,b)=>a.group.localeCompare(b.group)||a.currency.localeCompare(b.currency)));
 };
 const run=async(fn,msg)=>{setBusy(true);setError("");setNotice("");try{await fn();setNotice(msg);await load();}catch(e){setError(e.message||"Operation failed.");}finally{setBusy(false);}};
 const save=()=>run(async()=>{await rpc("main_workspace_save_custom_report",{p_workspace_id:workspaceId,p_report_name:reportName,p_metrics:metrics,p_group_by:groupBy,p_date_window_days:Number(days)});setReportName("");},"Custom report saved.");
 const deleteReport=id=>run(()=>rpc("main_workspace_delete_custom_report",{p_workspace_id:workspaceId,p_report_id:id}),"Saved report deleted.");
 if(!["admin","manager","accountant"].includes(user?.role))return null;
 return <section className="rounded-2xl border bg-white p-4 sm:p-5">
  <div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Business intelligence & cash-flow analytics</h2></div>
  <p className="mt-1 text-xs text-slate-500">Build saved reports from Workspace invoices, expenses, leads and stock. Amounts stay grouped by currency; no FX totals are mixed.</p>
  <div className="mt-4 grid gap-2 sm:grid-cols-3"><input className={input} placeholder="Report name" value={reportName} onChange={e=>setReportName(e.target.value)}/><select className={input} value={groupBy} onChange={e=>setGroupBy(e.target.value)}><option value="month">Group by month</option><option value="category">Group by expense category</option><option value="stage">Group by lead stage</option></select><select className={input} value={days} onChange={e=>setDays(e.target.value)}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 6 months</option><option value="365">Last 12 months</option></select></div>
  <div className="mt-3 flex flex-wrap gap-3">{METRICS.map(([m,label])=><label key={m} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={metrics.includes(m)} onChange={()=>toggleMetric(m)}/>{label}</label>)}</div>
  <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy||!metrics.length} onClick={()=>run(()=>runReport(),"Custom report generated.")}>Run report</button><button className={outline} disabled={busy||!reportName.trim()||!metrics.length} onClick={save}><Save className="mr-1 inline h-3.5 w-3.5"/>Save report</button><button className={outline} disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}><RefreshCw className="mr-1 inline h-3.5 w-3.5"/>Refresh</button></div>
  <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[540px] text-left text-xs"><thead><tr className="border-b text-slate-500"><th className="py-2">Group</th><th>Currency</th>{metrics.map(m=><th key={m} className="text-right">{m.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i} className="border-b"><td className="py-2">{r.group}</td><td>{r.currency}</td>{metrics.map(m=><td key={m} className="text-right tabular-nums">{Number(r[m]||0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>)}</tr>)}{!rows.length&&<tr><td colSpan={metrics.length+2} className="py-4 text-center text-slate-500">Run a report to see results.</td></tr>}</tbody></table></div>
  <div className="mt-5 border-t pt-4"><h3 className="text-sm font-semibold">Saved reports</h3><div className="mt-2 space-y-2">{reports.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-xs"><button className="text-left font-semibold text-violet-700" onClick={()=>{setMetrics(r.metrics);setGroupBy(r.group_by);setDays(String(r.date_window_days));run(()=>runReport({metrics:r.metrics,groupBy:r.group_by,days:r.date_window_days}),"Saved report loaded.");}}>{r.report_name} · {r.group_by} · {r.date_window_days} days</button><button className={outline} disabled={busy} onClick={()=>deleteReport(r.id)}><Trash2 className="h-3.5 w-3.5"/></button></div>)}{!reports.length&&<p className="text-xs text-slate-500">No saved reports yet.</p>}</div></div>
  <div className="mt-5 border-t pt-4"><h3 className="text-sm font-semibold">3-month cash-flow forecast</h3><p className="mt-1 text-xs text-slate-500">Rule-based estimate: open invoice totals by due month minus average monthly expenses from the trailing three months. Currencies are kept separate; partial receipts are not netted.</p><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[540px] text-xs"><thead><tr className="border-b text-slate-500"><th className="py-2">Month</th><th>Currency</th><th className="text-right">Receivables</th><th className="text-right">Expenses</th><th className="text-right">Net estimate</th></tr></thead><tbody>{forecast.map((r,i)=><tr key={i} className="border-b"><td className="py-2">{String(r.month).slice(0,7)}</td><td>{r.currency}</td><td className="text-right">{Number(r.expected_receivables).toLocaleString()}</td><td className="text-right">{Number(r.projected_expenses).toLocaleString()}</td><td className="text-right">{Number(r.projected_net).toLocaleString()}</td></tr>)}</tbody></table></div></div>
  <div className="mt-5 border-t pt-4"><h3 className="text-sm font-semibold">Six-month sales analytics</h3><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[500px] text-xs"><thead><tr className="border-b text-slate-500"><th className="py-2">Month</th><th>Currency</th><th className="text-right">Invoices</th><th className="text-right">Sales</th><th className="text-right">Paid</th><th className="text-right">Open</th></tr></thead><tbody>{sales.map((r,i)=><tr key={i} className="border-b"><td className="py-2">{String(r.month).slice(0,7)}</td><td>{r.currency}</td><td className="text-right">{r.invoice_count}</td><td className="text-right">{Number(r.sales_total).toLocaleString()}</td><td className="text-right">{r.paid_count}</td><td className="text-right">{r.open_count}</td></tr>)}</tbody></table></div></div>
  {(error||notice)&&<p role={error?"alert":"status"} className={"mt-3 rounded-lg p-2 text-xs "+(error?"bg-red-50 text-red-700":"bg-emerald-50 text-emerald-700")}>{error||notice}</p>}
 </section>;
}
