import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/api/backendClient";
import GlobalGstr2bPanel from "@/components/global/GlobalGstr2bPanel";

const field="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button="rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const secondary="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";
const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
const digits=(currency)=>{try{return new Intl.NumberFormat("en",{style:"currency",currency}).resolvedOptions().maximumFractionDigits;}catch{return 2;}};
const money=(minor,currency)=>new Intl.NumberFormat(undefined,{style:"currency",currency}).format(Number(minor||0)/(10**digits(currency)));
const toMinor=(value,currency)=>Math.round(Number(value||0)*(10**digits(currency)));

export default function GlobalAccountingPanel({account}) {
  const currency=account?.currency_code||"USD";
  const [accounts,setAccounts]=useState([]);
  const [view,setView]=useState("trial_balance");
  const [from,setFrom]=useState(`${new Date().getFullYear()}-01-01`);
  const [to,setTo]=useState(localDate());
  const [selectedAccount,setSelectedAccount]=useState("");
  const [report,setReport]=useState(null);
  const [loading,setLoading]=useState(false);
  const [posting,setPosting]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [memo,setMemo]=useState("");
  const [entryDate,setEntryDate]=useState(localDate());
  const [lines,setLines]=useState([
    {account_code:"1000",debit:"",credit:"",description:""},
    {account_code:"4000",debit:"",credit:"",description:""},
  ]);

  const loadAccounts=useCallback(async()=>{
    const {data,error:queryError}=await supabase.schema("global").from("accounting_accounts")
      .select("code,name,account_type,normal_balance").eq("workspace_id",account.workspace_id)
      .eq("is_active",true).order("code");
    if(queryError) throw queryError;
    setAccounts(data||[]);
    if(data?.length) {
      setSelectedAccount((current)=>current||data[0].code);
      setLines((current)=>current.map((line,index)=>({...line,account_code:line.account_code||data[index]?.code||data[0].code})));
    }
  },[account.workspace_id]);

  const loadReport=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const body={workspace_id:account.workspace_id,action:view,from:from||null,to:to||null,currency_code:currency};
      if(view==="financial_statements"){body.as_of=to;delete body.to;}
      if(view==="general_ledger") body.account_code=selectedAccount;
      const {data,error:invokeError}=await supabase.functions.invoke("global-accounting",{body});
      if(invokeError) throw invokeError;
      if(!data?.ok) throw new Error(data?.error||"Could not load accounting report.");
      setReport(data.report);
    }catch(e){
      let message=e.message||"Could not load accounting report.";
      try{const payload=await e?.context?.clone?.().json();if(payload?.error)message=payload.error;}catch{/* keep fallback */}
      setError(message);
    }finally{setLoading(false);}
  },[account.workspace_id,currency,from,to,view,selectedAccount]);

  useEffect(()=>{loadAccounts().catch((e)=>setError(e.message||"Could not load chart of accounts."));},[loadAccounts]);
  useEffect(()=>{if(accounts.length && view!=="gstr2b")loadReport();},[accounts.length,loadReport,view]);

  const totals=useMemo(()=>lines.reduce((sum,line)=>({
    debit:sum.debit+toMinor(line.debit,currency),
    credit:sum.credit+toMinor(line.credit,currency),
  }),{debit:0,credit:0}),[lines,currency]);

  const updateLine=(index,key,value)=>setLines((current)=>current.map((line,i)=>i===index?{...line,[key]:value}:line));
  const addLine=()=>setLines((current)=>current.length>=100?current:[...current,{account_code:accounts[0]?.code||"",debit:"",credit:"",description:""}]);
  const removeLine=(index)=>setLines((current)=>current.length<=2?current.filter((_,i)=>i!==index):current.filter((_,i)=>i!==index));

  const postEntry=async(event)=>{
    event.preventDefault();setPosting(true);setError("");setNotice("");
    try{
      if(!memo.trim()) throw new Error("Add a description for this journal entry.");
      if(totals.debit<=0||totals.debit!==totals.credit) throw new Error("Total debits and credits must match and be greater than zero.");
      const payloadLines=lines.map((line)=>({
        account_code:line.account_code,
        debit_minor:toMinor(line.debit,currency),
        credit_minor:toMinor(line.credit,currency),
        description:line.description.trim()||null,
      }));
      const {data,error:invokeError}=await supabase.functions.invoke("global-accounting",{
        body:{action:"post_journal_entry",workspace_id:account.workspace_id,entry_date:entryDate,
          currency_code:currency,memo:memo.trim(),source_type:"manual",idempotency_key:crypto.randomUUID(),lines:payloadLines},
      });
      if(invokeError) throw invokeError;
      if(!data?.ok) throw new Error(data?.error||"Journal entry could not be posted.");
      setNotice(data.duplicate?"This journal entry was already posted.":"Journal entry posted and locked.");
      setMemo("");setLines([{account_code:accounts[0]?.code||"1000",debit:"",credit:"",description:""},{account_code:accounts[1]?.code||"4000",debit:"",credit:"",description:""}]);
      await loadReport();
    }catch(e){
      let message=e.message||"Journal entry could not be posted.";
      try{const payload=await e?.context?.clone?.().json();if(payload?.error)message=payload.error;}catch{/* keep fallback */}
      setError(message);
    }finally{setPosting(false);}
  };

  const rows=view==="trial_balance"?(report?.accounts||[]):view==="general_ledger"?(report?.entries||[]):[];
  const statement=report?.income_statement;
  const balance=report?.balance_sheet;

  return <section className="mt-6 space-y-5">
    <div><h1 className="text-2xl font-bold">Accounting & financials</h1><p className="mt-1 text-sm text-slate-500">A balanced, workspace-scoped ledger. All values are stored in {currency} minor units.</p></div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="flex flex-wrap gap-2">
      {[["trial_balance","Trial Balance"],["general_ledger","General Ledger"],["financial_statements","Financial Statements"],["gstr2b","GSTR-2B / ITC"]].map(([id,label])=><button key={id} onClick={()=>setView(id)} className={view===id?"rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white":secondary}>{label}</button>)}
    </div>
    {view!=="gstr2b"&&<div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <label className="text-xs font-semibold text-slate-600">From<input type="date" className={field+" mt-1"} value={from} onChange={(e)=>setFrom(e.target.value)}/></label>
      <label className="text-xs font-semibold text-slate-600">To / as of<input type="date" className={field+" mt-1"} value={to} onChange={(e)=>setTo(e.target.value)}/></label>
      {view==="general_ledger"&&<label className="min-w-48 text-xs font-semibold text-slate-600">Account<select className={field+" mt-1"} value={selectedAccount} onChange={(e)=>setSelectedAccount(e.target.value)}>{accounts.map((a)=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></label>}
      <button className={secondary} disabled={loading} onClick={loadReport}>{loading?"Loading…":"Refresh report"}</button>
    </div>}
    {view==="gstr2b"?<GlobalGstr2bPanel account={account}/>:loading?<div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading accounting report…</div>:view==="trial_balance"?(
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{["Code","Account","Type","Debit","Credit","Net debit"].map((x)=><th key={x} className="whitespace-nowrap px-4 py-3 font-semibold">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
          {rows.map((row)=><tr key={row.code}><td className="px-4 py-3 font-semibold">{row.code}</td><td className="px-4 py-3">{row.name}</td><td className="px-4 py-3 capitalize">{row.account_type}</td><td className="px-4 py-3">{money(row.debit_minor,currency)}</td><td className="px-4 py-3">{money(row.credit_minor,currency)}</td><td className="px-4 py-3">{money(row.net_debit_minor,currency)}</td></tr>)}
        </tbody><tfoot className="border-t bg-slate-50 font-bold"><tr><td className="px-4 py-3" colSpan="3">Totals</td><td className="px-4 py-3">{money(report?.total_debit_minor,currency)}</td><td className="px-4 py-3">{money(report?.total_credit_minor,currency)}</td><td/></tr></tfoot></table>
        {!rows.length&&<p className="p-6 text-center text-sm text-slate-500">No journal entries in this period.</p>}
      </div>
    ):view==="general_ledger"?(
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b px-4 py-3 text-sm font-semibold">{report?.account_code} · {report?.account_name}<span className="ml-3 text-xs font-normal text-slate-500">Opening balance: {money(report?.opening_balance_minor,currency)}</span></div>
        <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{["Date","Description","Source","Debit","Credit","Running balance"].map((x)=><th key={x} className="whitespace-nowrap px-4 py-3 font-semibold">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
          {rows.map((row,index)=><tr key={`${row.entry_id}-${index}`}><td className="whitespace-nowrap px-4 py-3">{row.entry_date}</td><td className="px-4 py-3">{row.description||row.memo}</td><td className="px-4 py-3">{row.source_type}</td><td className="px-4 py-3">{money(row.debit_minor,currency)}</td><td className="px-4 py-3">{money(row.credit_minor,currency)}</td><td className="px-4 py-3">{money(row.running_debit_minor,currency)}</td></tr>)}
        </tbody></table>
        {!rows.length&&<p className="p-6 text-center text-sm text-slate-500">No entries for this account in the selected period.</p>}
      </div>
    ):(
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Income statement</h2><p className="mt-1 text-xs text-slate-500">{from||"All time"} to {to}</p>
          <div className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><span>Revenue</span><strong>{money(statement?.revenue_minor,currency)}</strong></div><div className="flex justify-between"><span>Expenses</span><strong>{money(statement?.expenses_minor,currency)}</strong></div><div className="flex justify-between border-t pt-3 text-base"><span>Net income</span><strong>{money(statement?.net_income_minor,currency)}</strong></div></div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Balance sheet</h2><p className="mt-1 text-xs text-slate-500">Position as of {to}</p>
          <div className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><span>Assets</span><strong>{money(balance?.assets_minor,currency)}</strong></div><div className="flex justify-between"><span>Liabilities</span><strong>{money(balance?.liabilities_minor,currency)}</strong></div><div className="flex justify-between"><span>Equity</span><strong>{money(balance?.equity_minor,currency)}</strong></div><div className="flex justify-between"><span>Unclosed earnings</span><strong>{money(balance?.unclosed_earnings_minor,currency)}</strong></div><div className="flex justify-between border-t pt-3"><span>Total equity & liabilities</span><strong>{money(balance?.total_equity_and_liabilities_minor,currency)}</strong></div><p className={balance?.balanced?"text-emerald-700":"text-amber-700"}>{balance?.balanced?"Balance sheet is balanced.":"Balance sheet does not balance yet."}</p></div>
        </div>
      </div>
    )}
    {view!=="gstr2b"&&<form onSubmit={postEntry} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div><h2 className="font-bold">Post a journal entry</h2><p className="mt-1 text-xs text-slate-500">Debits must equal credits. Posted entries are locked; corrections require a new reversing entry.</p></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Entry date<input required type="date" className={field+" mt-1"} value={entryDate} onChange={(e)=>setEntryDate(e.target.value)}/></label><label className="text-xs font-semibold text-slate-600">Description<input required maxLength="500" className={field+" mt-1"} value={memo} onChange={(e)=>setMemo(e.target.value)} placeholder="e.g. Owner capital introduced"/></label></div>
      <div className="space-y-2">
        {lines.map((line,index)=><div key={index} className="grid gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-[1.5fr_1fr_1fr_1.2fr_auto]">
          <select required className={field} value={line.account_code} onChange={(e)=>updateLine(index,"account_code",e.target.value)}>{accounts.map((a)=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select>
          <input aria-label={"Debit line "+(index+1)} className={field} type="number" min="0" step="0.01" placeholder="Debit" value={line.debit} onChange={(e)=>updateLine(index,"debit",e.target.value)}/>
          <input aria-label={"Credit line "+(index+1)} className={field} type="number" min="0" step="0.01" placeholder="Credit" value={line.credit} onChange={(e)=>updateLine(index,"credit",e.target.value)}/>
          <input aria-label={"Line description "+(index+1)} className={field} maxLength="300" placeholder="Line note" value={line.description} onChange={(e)=>updateLine(index,"description",e.target.value)}/>
          <button type="button" className={secondary} disabled={lines.length<=2} onClick={()=>removeLine(index)} aria-label={"Remove line "+(index+1)}>×</button>
        </div>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" className={secondary} disabled={lines.length>=100} onClick={addLine}>Add line</button><div className="text-sm font-semibold">Debit {money(totals.debit,currency)} · Credit {money(totals.credit,currency)}</div></div>
      <button disabled={posting||!accounts.length} className={button}>{posting?"Posting…":"Post journal entry"}</button>
    </form>}
    {view!=="gstr2b"&&<p className="text-xs text-slate-500">Accounting currently posts in the workspace base currency only. Foreign-currency conversion and historical opening balances are not guessed or created automatically.</p>}
  </section>;
}
