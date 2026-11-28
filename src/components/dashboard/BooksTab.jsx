import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, FileText, Loader2, Plus, RefreshCw, Scale, Trash2, TrendingUp } from "lucide-react";
import { supabase } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";

const isoToday = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const firstDayOfMonth = () => isoToday().slice(0, 8) + "01";
const blankLine = () => ({ account_id: "", debit: "", credit: "", memo: "" });
const newRequestKey = () => {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Secure journal submission is unavailable in this browser. Update your browser and try again.");
  }
  return crypto.randomUUID();
};
const toFourDecimals = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 10000) : NaN;
};
const money = (value, currency, locale) => {
  try {
    return new Intl.NumberFormat(locale || "en-IN", {
      style: "currency", currency: currency || "INR", maximumFractionDigits: 2,
    }).format(Number(value) || 0);
  } catch {
    return (currency || "INR") + " " + (Number(value) || 0).toFixed(2);
  }
};

function Section({ title, icon: Icon, children, action }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Icon className="h-4 w-4 text-violet-700" />{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function BooksTab() {
  const { user } = useAuth();
  const workspaceId = user?.workspace_id;
  const currencyCode = user?.currency_code || "INR";
  const locale = user?.locale_code || "en-IN";
  const [from, setFrom] = useState(firstDayOfMonth);
  const [to, setTo] = useState(isoToday);
  const [accounts, setAccounts] = useState([]);
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [postingId, setPostingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showJournalForm, setShowJournalForm] = useState(false);
  const [entryDate, setEntryDate] = useState(isoToday);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState([blankLine(), blankLine()]);
  const requestKeyRef = useRef(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      setError("Your Main Workspace could not be identified. Sign in again and retry.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [chartResult, journalResult, reportResult] = await Promise.all([
        supabase.rpc("main_workspace_list_bank_data", { p_workspace_id: workspaceId }),
        supabase.rpc("main_workspace_list_journal_entries", { p_workspace_id: workspaceId }),
        supabase.rpc("main_workspace_accounting_summary", { p_workspace_id: workspaceId, p_from: from, p_to: to }),
      ]);
      if (chartResult.error) throw chartResult.error;
      if (journalResult.error) throw journalResult.error;
      if (reportResult.error) throw reportResult.error;
      if (chartResult.data?.ok !== true) throw new Error(chartResult.data?.reason || "Chart of accounts could not be loaded.");
      if (journalResult.data?.ok !== true) throw new Error(journalResult.data?.reason || "Journal entries could not be loaded.");
      if (reportResult.data?.ok !== true) throw new Error(reportResult.data?.reason || "Accounting reports could not be loaded.");
      const nextAccounts = Array.isArray(chartResult.data.chart_accounts) ? chartResult.data.chart_accounts : [];
      setAccounts(nextAccounts);
      setEntries(Array.isArray(journalResult.data.entries) ? journalResult.data.entries : []);
      setSummary(reportResult.data);
      setLines((current) => current.map((line) => line.account_id || !nextAccounts[0]?.id
        ? line : { ...line, account_id: nextAccounts[0].id }));
    } catch (loadError) {
      setError(loadError?.message || "Books could not be loaded. Please retry.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, from, to]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => lines.reduce((result, line) => {
    const debit = toFourDecimals(line.debit);
    const credit = toFourDecimals(line.credit);
    return {
      debit: result.debit + (Number.isFinite(debit) ? debit : 0),
      credit: result.credit + (Number.isFinite(credit) ? credit : 0),
    };
  }, { debit: 0, credit: 0 }), [lines]);
  const balanced = totals.debit > 0 && totals.debit === totals.credit && lines.length >= 2
    && lines.every((line) => line.account_id && (
      (Number(line.debit || 0) > 0 && Number(line.credit || 0) === 0)
      || (Number(line.credit || 0) > 0 && Number(line.debit || 0) === 0)
    ));
  const debitTotal = totals.debit / 10000;
  const creditTotal = totals.credit / 10000;

  const changeForm = (setter, value) => {
    setter(value);
    requestKeyRef.current = null;
  };
  const changeLine = (index, patch) => {
    requestKeyRef.current = null;
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  };
  const addLine = () => {
    if (lines.length >= 100) return;
    requestKeyRef.current = null;
    setLines((current) => [...current, { ...blankLine(), account_id: accounts[0]?.id || "" }]);
  };
  const removeLine = (index) => {
    if (lines.length <= 2) return;
    requestKeyRef.current = null;
    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
  };

  const createJournal = async (event) => {
    event.preventDefault();
    if (!balanced || !description.trim() || !entryDate || !workspaceId || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (!requestKeyRef.current) requestKeyRef.current = newRequestKey();
      const payloadLines = lines.map((line) => ({
        account_id: line.account_id,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
        memo: String(line.memo || "").trim().slice(0, 300),
      }));
      const { data, error: rpcError } = await supabase.rpc("main_workspace_create_journal_entry", {
        p_workspace_id: workspaceId,
        p_entry_date: entryDate,
        p_description: description.trim(),
        p_currency_code: currencyCode,
        p_lines: payloadLines,
        p_idempotency_key: requestKeyRef.current,
      });
      if (rpcError) throw rpcError;
      if (data?.ok !== true) {
        if (data?.reason === "idempotency_conflict") requestKeyRef.current = null;
        throw new Error(data?.reason || "Journal entry could not be saved.");
      }
      setNotice(data.duplicate
        ? "This journal entry was already saved. No duplicate was created."
        : "Draft journal " + (data.entry_number || "") + " saved. Review it and post when ready.");
      requestKeyRef.current = null;
      setDescription("");
      setEntryDate(isoToday());
      setLines([blankLine(), blankLine()].map((line) => ({ ...line, account_id: accounts[0]?.id || "" })));
      setShowJournalForm(false);
      await load();
    } catch (saveError) {
      setError(saveError?.message || "Journal entry could not be saved. Please retry.");
    } finally {
      setSaving(false);
    }
  };

  const postJournal = async (entryId) => {
    if (!workspaceId || !entryId || postingId) return;
    setPostingId(entryId);
    setError("");
    setNotice("");
    try {
      const { data, error: rpcError } = await supabase.rpc("main_workspace_post_journal_entry", {
        p_workspace_id: workspaceId, p_entry_id: entryId,
      });
      if (rpcError) throw rpcError;
      if (data?.ok !== true) throw new Error(data?.reason || "Journal entry could not be posted.");
      setNotice("Journal entry posted to the accounting ledger.");
      await load();
    } catch (postError) {
      setError(postError?.message || "Journal entry could not be posted. Please retry.");
    } finally {
      setPostingId("");
    }
  };

  const trialBalance = Array.isArray(summary?.trial_balance) ? summary.trial_balance : [];
  const incomeStatement = Array.isArray(summary?.income_statement) ? summary.income_statement : [];
  const balanceSheet = Array.isArray(summary?.balance_sheet) ? summary.balance_sheet : [];
  const cashBankMovement = Array.isArray(summary?.cash_bank_movement) ? summary.cash_bank_movement : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900"><BookOpen className="h-5 w-5 text-violet-700" />Books & Accounting</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Journal entries, trial balance and financial summaries from your Main Workspace ledger.</p>
        </div>
        <button type="button" onClick={() => { setShowJournalForm((value) => !value); setError(""); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800">
          <Plus className="h-4 w-4" />New journal
        </button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {showJournalForm && (
        <Section title="Create balanced journal entry" icon={FileText}>
          <form onSubmit={createJournal} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-semibold text-slate-600">Entry date
                <input required type="date" value={entryDate} onChange={(event) => changeForm(setEntryDate, event.target.value)} className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-600">Currency
                <input readOnly value={currencyCode} className="min-h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm" />
              </label>
            </div>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">Description
              <input required minLength={2} maxLength={300} value={description} onChange={(event) => changeForm(setDescription, event.target.value)} placeholder="e.g. Opening capital introduced" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" />
            </label>
            {accounts.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No active chart accounts are available for this workspace yet.</p>}
            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(90px,.7fr)_minmax(90px,.7fr)_minmax(0,1fr)_auto]">
                  <label className="grid gap-1 text-[11px] font-semibold text-slate-600">Account
                    <select required value={line.account_id} onChange={(event) => changeLine(index, { account_id: event.target.value })} className="min-h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs">
                      <option value="">Select account</option>
                      {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[11px] font-semibold text-slate-600">Debit
                    <input type="number" min="0" step="0.0001" value={line.debit} onChange={(event) => changeLine(index, { debit: event.target.value, credit: event.target.value ? "0" : line.credit })} className="min-h-9 min-w-0 rounded-lg border border-slate-200 px-2 text-xs" placeholder="0.00" />
                  </label>
                  <label className="grid gap-1 text-[11px] font-semibold text-slate-600">Credit
                    <input type="number" min="0" step="0.0001" value={line.credit} onChange={(event) => changeLine(index, { credit: event.target.value, debit: event.target.value ? "0" : line.debit })} className="min-h-9 min-w-0 rounded-lg border border-slate-200 px-2 text-xs" placeholder="0.00" />
                  </label>
                  <label className="grid gap-1 text-[11px] font-semibold text-slate-600">Memo
                    <input maxLength={300} value={line.memo} onChange={(event) => changeLine(index, { memo: event.target.value })} className="min-h-9 min-w-0 rounded-lg border border-slate-200 px-2 text-xs" placeholder="Optional" />
                  </label>
                  <button type="button" disabled={lines.length <= 2} onClick={() => removeLine(index)} aria-label={"Remove journal line " + (index + 1)} className="self-end rounded-lg border border-slate-200 p-2 text-slate-500 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" disabled={lines.length >= 100} onClick={addLine} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Add line</button>
              <div className="text-right text-xs text-slate-600">
                <p>Debits: <strong>{money(debitTotal, currencyCode, locale)}</strong></p>
                <p>Credits: <strong>{money(creditTotal, currencyCode, locale)}</strong></p>
                <p className={balanced ? "font-bold text-emerald-700" : "font-bold text-amber-700"}>{balanced ? "Balanced" : "Debits and credits must match"}</p>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setShowJournalForm(false)} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-600">Cancel</button>
              <button type="submit" disabled={!balanced || !description.trim() || accounts.length === 0 || saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save draft
              </button>
            </div>
          </form>
        </Section>
      )}

      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mr-auto"><h3 className="text-sm font-bold text-slate-900">Report period</h3><p className="mt-1 text-xs text-slate-500">Posted journal entries only. Each currency is reported separately.</p></div>
        <label className="grid gap-1 text-[11px] font-semibold text-slate-600">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="min-h-9 rounded-lg border border-slate-200 px-2 text-xs" /></label>
        <label className="grid gap-1 text-[11px] font-semibold text-slate-600">To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="min-h-9 rounded-lg border border-slate-200 px-2 text-xs" /></label>
        <button type="button" onClick={load} disabled={loading} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"><RefreshCw className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} />Refresh</button>
      </section>

      {loading ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Loading books…</div> : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Section title="Profit & loss" icon={TrendingUp}>
              {incomeStatement.length ? <div className="space-y-3">{incomeStatement.map((row) => <div key={row.currency_code} className="grid grid-cols-3 gap-2 text-xs"><div><p className="text-slate-500">Revenue</p><p className="mt-1 font-semibold text-slate-900">{money(row.revenue, row.currency_code, locale)}</p></div><div><p className="text-slate-500">Expenses</p><p className="mt-1 font-semibold text-slate-900">{money(row.expenses, row.currency_code, locale)}</p></div><div><p className="text-slate-500">Net profit</p><p className={"mt-1 font-bold " + (Number(row.net_profit) >= 0 ? "text-emerald-700" : "text-rose-700")}>{money(row.net_profit, row.currency_code, locale)}</p></div></div>)}</div> : <p className="text-xs text-slate-500">No posted income or expense journals in this period.</p>}
            </Section>
            <Section title="Balance sheet" icon={Scale}>
              {balanceSheet.length ? <div className="space-y-3">{balanceSheet.map((row) => <div key={row.currency_code} className="grid grid-cols-2 gap-2 text-xs"><div><p className="text-slate-500">Assets</p><p className="mt-1 font-semibold">{money(row.assets, row.currency_code, locale)}</p></div><div><p className="text-slate-500">Liabilities</p><p className="mt-1 font-semibold">{money(row.liabilities, row.currency_code, locale)}</p></div><div><p className="text-slate-500">Equity incl. current earnings</p><p className="mt-1 font-semibold">{money(row.total_equity, row.currency_code, locale)}</p></div><div><p className="text-slate-500">Balance difference</p><p className={"mt-1 font-bold " + (Math.abs(Number(row.balance_difference)) < 0.0001 ? "text-emerald-700" : "text-amber-700")}>{money(row.balance_difference, row.currency_code, locale)}</p></div></div>)}</div> : <p className="text-xs text-slate-500">No posted balance-sheet entries through the report end date.</p>}
            </Section>
          </div>

          <Section title="Trial balance" icon={Scale}>
            {trialBalance.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead><tr className="border-b border-slate-100 text-slate-500"><th className="py-2 pr-3">Account</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Currency</th><th className="py-2 pr-3 text-right">Debit balance</th><th className="py-2 text-right">Credit balance</th></tr></thead><tbody>{trialBalance.map((row) => <tr key={row.account_id + row.currency_code} className="border-b border-slate-50"><td className="py-2 pr-3"><strong>{row.code}</strong> · {row.name}</td><td className="py-2 pr-3 capitalize">{row.account_type}</td><td className="py-2 pr-3">{row.currency_code}</td><td className="py-2 pr-3 text-right tabular-nums">{money(row.debit_balance, row.currency_code, locale)}</td><td className="py-2 text-right tabular-nums">{money(row.credit_balance, row.currency_code, locale)}</td></tr>)}</tbody></table></div> : <p className="text-xs text-slate-500">No posted journal entries are available for the trial balance yet.</p>}
          </Section>

          <Section title="Cash & bank movement" icon={BookOpen}>
            {cashBankMovement.length ? <div className="flex flex-wrap gap-3">{cashBankMovement.map((row) => <div key={row.currency_code} className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-[11px] text-slate-500">{row.currency_code} movement</p><p className="mt-1 text-base font-bold text-slate-900">{money(row.cash_bank_increase, row.currency_code, locale)}</p></div>)}</div> : <p className="text-xs text-slate-500">No posted movement in the Cash on Hand and Bank Account control accounts for this period.</p>}
          </Section>
        </>
      )}

      <Section title="Journal register" icon={FileText} action={<span className="text-[11px] text-slate-500">Latest {entries.length} entries</span>}>
        {entries.length ? <div className="space-y-2">{entries.map((entry) => <article key={entry.id} className="rounded-xl border border-slate-100 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><p className="text-xs font-bold text-slate-900">{entry.entry_number} · {entry.description}</p><p className="mt-1 text-[11px] text-slate-500">{entry.entry_date} · {entry.currency_code} · {entry.status}</p></div>
            <div className="text-right"><p className="text-xs font-semibold">{money(entry.debits, entry.currency_code, locale)}</p><p className="text-[10px] text-slate-500">Debits / credits</p></div>
          </div>
          {Array.isArray(entry.lines) && <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">{entry.lines.map((line, index) => <div key={entry.id + "-" + index} className="flex flex-wrap justify-between gap-2 text-[11px] text-slate-600"><span>{line.account_name}</span><span>{line.debit > 0 ? "Dr " + money(line.debit, entry.currency_code, locale) : "Cr " + money(line.credit, entry.currency_code, locale)}</span></div>)}</div>}
          {entry.status === "draft" && <div className="mt-3 flex justify-end"><button type="button" disabled={postingId === entry.id} onClick={() => postJournal(entry.id)} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white disabled:opacity-50">{postingId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Post journal</button></div>}
        </article>)}</div> : <p className="text-xs text-slate-500">No journal entries yet. Create a balanced draft to begin your accounting ledger.</p>}
      </Section>
      <p className="text-[11px] leading-5 text-slate-500">Draft journals are excluded from all reports. Posted entries are append-only through the current workflow. Currency totals are never converted or combined automatically. Cash & bank movement is a control-account movement, not a full cash-flow statement.</p>
    </div>
  );
}
