import { useCallback,useEffect,useState } from "react";
import { supabase } from "@/api/backendClient";

const field="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const button="rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50";
const outline="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");};
const yearStart=()=>new Date().getFullYear()+"-01-01";
const amount=value=>Number(value||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});

export default function WorkspaceAccountingReports({workspaceId,currency,accounts=[]}){
 const [asOf,setAsOf]=useState(today());
 const [period,setPeriod]=useState({from:yearStart(),to:today()});
 const [trial,setTrial]=useState(null);
 const [statements,setStatements]=useState(null);
 const [accountCode,setAccountCode]=useState("");
 const [ledger,setLedger]=useState(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const rpc=async(name,args)=>{const {data,error}=await supabase.rpc(name,args);if(error)throw error;if(data?.ok===false)throw new Error(data.reason||"Accounting report could not be loaded.");return data;};
 const load=useCallback(async()=>{
  if(!workspaceId)return;
  setBusy(true);setError("");
  try{
   const [tb,fs]=await Promise.all([
    rpc("main_workspace_trial_balance",{p_workspace_id:workspaceId,p_as_of:asOf}),
    rpc("main_workspace_financial_statements",{p_workspace_id:workspaceId,p_from:period.from,p_to:period.to}),
   ]);
   setTrial(tb);setStatements(fs);
  }catch(e){setError(e.message||"Accounting reports are unavailable.");}
  finally{setBusy(false);}
 },[workspaceId,asOf,period.from,period.to]);
 useEffect(()=>{load();},[load]);
 const loadLedger=async()=>{
  if(!accountCode){setError("Choose a chart-of-accounts code first.");return;}
  setBusy(true);setError("");
  try{setLedger(await rpc("main_workspace_general_ledger",{p_workspace_id:workspaceId,p_account_code:accountCode,p_from:period.from,p_to:period.to}));}
  catch(e){setError(e.message||"General ledger could not be loaded.");}
  finally{setBusy(false);}
 };
 const rows=(value)=>Array.isArray(value)?value:[];
 const lineTable=(title,data,totalLabel,totalValue)=> <div className="rounded-xl border p-3">
  <h4 className="text-sm font-semibold">{title}</h4>
  <div className="mt-2 space-y-1">{rows(data).map((x,i)=><div key={x.code||i} className="flex justify-between gap-3 border-b py-1 text-xs"><span>{x.code} · {x.name}</span><span className="tabular-nums">{amount(x.amount)}</span></div>)}
   {!rows(data).length&&<p className="text-xs text-slate-500">No posted activity in this period.</p>}
  </div>
  <div className="mt-2 flex justify-between text-xs font-semibold"><span>{totalLabel}</span><span className="tabular-nums">{amount(totalValue)}</span></div>
 </div>;
 return <section className="rounded-2xl border bg-white p-4 sm:p-5">
  <h2 className="font-semibold">Financial reports</h2>
  <p className="mt-1 text-xs text-slate-500">Posted journals only · {currency} base currency · draft entries are excluded</p>
  <div className="mt-4 grid gap-2 sm:grid-cols-3">
   <label className="text-xs text-slate-600">Trial balance as of<input className={field+" mt-1"} type="date" value={asOf} onChange={e=>setAsOf(e.target.value)}/></label>
   <label className="text-xs text-slate-600">Statement period from<input className={field+" mt-1"} type="date" value={period.from} onChange={e=>setPeriod(v=>({...v,from:e.target.value}))}/></label>
   <label className="text-xs text-slate-600">Statement period to<input className={field+" mt-1"} type="date" value={period.to} onChange={e=>setPeriod(v=>({...v,to:e.target.value}))}/></label>
  </div>
  <button className={button+" mt-3"} disabled={busy||!period.from||!period.to||period.to<period.from} onClick={load}>Refresh financial reports</button>
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
  {trial&&<div className="mt-5">
   <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Trial balance · {trial.as_of}</h3><span className={"text-xs font-semibold "+(trial.balanced?"text-emerald-700":"text-red-700")}>{trial.balanced?"Debits and credits balance":"Difference detected"}</span></div>
   <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[620px] text-xs"><thead><tr className="border-b text-left text-slate-500"><th className="py-2">Code</th><th>Account</th><th className="text-right">Debits</th><th className="text-right">Credits</th><th className="text-right">Debit balance</th><th className="text-right">Credit balance</th></tr></thead><tbody>{rows(trial.accounts).map(a=><tr key={a.account_id} className="border-b"><td className="py-2">{a.code}</td><td>{a.name}</td><td className="text-right tabular-nums">{amount(a.debits)}</td><td className="text-right tabular-nums">{amount(a.credits)}</td><td className="text-right tabular-nums">{amount(a.debit_balance)}</td><td className="text-right tabular-nums">{amount(a.credit_balance)}</td></tr>)}</tbody><tfoot><tr className="font-semibold"><td className="py-2" colSpan="4">Totals</td><td className="text-right tabular-nums">{amount(trial.debit_total)}</td><td className="text-right tabular-nums">{amount(trial.credit_total)}</td></tr></tfoot></table></div>
  </div>}
  {statements&&<div className="mt-5 space-y-3">
   <h3 className="text-sm font-semibold">Profit & loss · {statements.from} to {statements.to}</h3>
   <div className="grid gap-3 md:grid-cols-2">
    {lineTable("Income",statements.profit_loss?.income,"Total income",statements.profit_loss?.income_total)}
    {lineTable("Expenses",statements.profit_loss?.expenses,"Total expenses",statements.profit_loss?.expense_total)}
   </div>
   <div className="flex flex-wrap justify-between rounded-lg bg-slate-50 p-3 text-sm"><span>Net profit / (loss)</span><strong className="tabular-nums">{currency} {amount(statements.profit_loss?.net_profit)}</strong></div>
   <h3 className="pt-2 text-sm font-semibold">Balance sheet as of {statements.to}</h3>
   <div className="grid gap-3 md:grid-cols-3">
    {lineTable("Assets",statements.balance_sheet?.assets,"Total assets",statements.balance_sheet?.asset_total)}
    {lineTable("Liabilities",statements.balance_sheet?.liabilities,"Total liabilities",statements.balance_sheet?.liability_total)}
    {lineTable("Equity",statements.balance_sheet?.equity,"Posted equity",statements.balance_sheet?.equity_total)}
   </div>
   <div className="flex flex-wrap justify-between rounded-lg bg-slate-50 p-3 text-sm"><span>Current period profit included in equity reconciliation</span><strong className="tabular-nums">{currency} {amount(statements.balance_sheet?.current_period_profit)}</strong></div>
   <div className="flex flex-wrap justify-between rounded-lg border p-3 text-sm"><span>Balance sheet difference</span><strong className={"tabular-nums "+(statements.balance_sheet?.balanced?"text-emerald-700":"text-red-700")}>{currency} {amount(statements.balance_sheet?.balance_check)} · {statements.balance_sheet?.balanced?"Balanced":"Needs review"}</strong></div>
  </div>}
  <div className="mt-5 border-t pt-4">
   <h3 className="text-sm font-semibold">General ledger</h3>
   <div className="mt-2 flex flex-wrap gap-2"><select className={field+" min-w-[220px] flex-1"} value={accountCode} onChange={e=>setAccountCode(e.target.value)}><option value="">Choose account code</option>{accounts.map(a=><option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}</select><button className={outline} disabled={busy||!accountCode||period.to<period.from} onClick={loadLedger}>Load ledger</button></div>
   {ledger&&<div className="mt-3 overflow-x-auto"><p className="mb-2 text-xs text-slate-500">{ledger.account?.code} · {ledger.account?.name} · Opening balance {amount(ledger.opening_balance)} {ledger.currency_code}</p><table className="w-full min-w-[560px] text-xs"><thead><tr className="border-b text-left text-slate-500"><th className="py-2">Date</th><th>Entry</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Running balance</th></tr></thead><tbody>{rows(ledger.entries).map((x,i)=><tr key={x.entry_id+"-"+i} className="border-b"><td className="py-2">{x.entry_date}</td><td>{x.entry_number}</td><td>{x.memo||x.description}</td><td className="text-right tabular-nums">{amount(x.debit)}</td><td className="text-right tabular-nums">{amount(x.credit)}</td><td className="text-right tabular-nums">{amount(x.running_balance)}</td></tr>)}</tbody></table></div>}
  </div>
  <p className="mt-3 text-[11px] text-slate-500">Reports are calculated from posted journal entries. Invoice, expense and bank records that have not been posted to the journal are not included; this prevents draft or unverified transactions from changing statutory balances.</p>
 </section>;
}
