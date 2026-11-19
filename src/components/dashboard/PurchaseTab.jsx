import { useAuth } from "@/lib/AuthContext";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X, Search, ChevronDown, ChevronRight, RotateCcw, Wallet, TrendingUp, PiggyBank } from "lucide-react";
import { KEYS, loadList, saveList, removeItem, genId } from "@/lib/stores";
import { inputCls, btnGhost } from "@/lib/ui";
import { money2, dateLabel, btnAccent, Empty } from "@/lib/dashboardData";
import { paginate, totalPages } from "@/lib/paging";
import { usePaywall } from "@/lib/paywall";
import { useRole } from "@/lib/roles";
import SummaryCard from "@/components/dashboard/SummaryCard";

const CATS = ["Rent", "Raw Materials", "Utilities", "Salary", "Logistics", "Software", "Marketing", "Other"];
const localDate = (offsetDays = 0) => { const now = new Date(); now.setDate(now.getDate() + offsetDays); return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0"); };
const blank = { vendor: "", category: "Raw Materials", amount: "", date: localDate(), status: "Unpaid", method: "Bank Transfer", notes: "" };

export default function PurchaseTab({ intent, onConsumeIntent }) {
  const { requestAction, limits, usage, openPaywall } = usePaywall();
  const { user } = useAuth();
  const currencyCode = user?.currency_code || "INR";
  const recordedExpenseAmount = (expense) => /^[A-Z]{3}$/.test(String(expense?.currencyCode || "").trim().toUpperCase())
    ? money2(expense.amount, String(expense.currencyCode).trim().toUpperCase())
    : "Currency not recorded";
  const { isAccountant } = useRole();
  const [expenses, setExpenses] = useState(() => loadList(KEYS.expenses));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cat, setCat] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  useEffect(() => { if (intent === "new-expense") { setOpen(true); onConsumeIntent(); } }, [intent]);

  const now = new Date();
  const monthStart = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01";
  const monthExpenses = expenses.filter((e) => String(e.date || "").slice(0, 10) >= monthStart);
  const expensesByCurrency = new Map();
  monthExpenses.forEach((e) => {
    const currency = String(e.currencyCode || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return;
    expensesByCurrency.set(currency, (expensesByCurrency.get(currency) || 0) + Number(e.amount || 0));
  });
  const monthExp = [...expensesByCurrency.entries()]
    .sort(([a], [b]) => a === currencyCode ? -1 : b === currencyCode ? 1 : a.localeCompare(b))
    .map(([currency, amount]) => money2(amount, currency))
    .join(" · ") || (monthExpenses.length ? "Currency not recorded" : money2(0, currencyCode));
  const baseCurrencyExpenses = expensesByCurrency.get(currencyCode) || 0;
  const hasOtherCurrencyExpenses = [...expensesByCurrency.keys()].some((currency) => currency !== currencyCode);
  const hasUnknownCurrencyExpenses = monthExpenses.some((e) => !/^[A-Z]{3}$/.test(String(e.currencyCode || "").trim().toUpperCase()));
  const monthInvoices = loadList(KEYS.history).filter((it) => String(it.issueDate || it.createdDate || "").slice(0, 10) >= monthStart);
  const salesByCurrency = new Map();
  monthInvoices.forEach((it) => {
    const currency = String(it.currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return;
    salesByCurrency.set(currency, (salesByCurrency.get(currency) || 0) + Number(it.total || 0));
  });
  const monthSales = [...salesByCurrency.entries()]
    .sort(([a], [b]) => a === currencyCode ? -1 : b === currencyCode ? 1 : a.localeCompare(b))
    .map(([currency, amount]) => money2(amount, currency))
    .join(" · ") || (monthInvoices.length ? "Currency not recorded" : money2(0, currencyCode));
  const baseCurrencySales = salesByCurrency.get(currencyCode) || 0;
  const hasOtherCurrencySales = [...salesByCurrency.keys()].some((currency) => currency !== currencyCode);
  const hasUnknownCurrencySales = monthInvoices.some((it) => !/^[A-Z]{3}$/.test(String(it.currency || "").trim().toUpperCase()));
  const net = baseCurrencySales - baseCurrencyExpenses;

  const expenseStatus = (e) => {
    if (e.status === "Paid" || e.status === "Received" || e.status === "Cancelled") return e.status;
    const overdue = String(e.date || "").slice(0, 10) < localDate(-7);
    return overdue ? "Overdue" : (e.status || "Unpaid");
  };

  const filtered = useMemo(() => expenses.filter((e) => {
    const hay = `${e.vendor} ${e.category} ${e.notes}`.toLowerCase();
    if (q && !hay.includes(q.toLowerCase())) return false;
    if (from && String(e.date || "").slice(0, 10) < from) return false;
    if (to && String(e.date || "").slice(0, 10) > to) return false;
    if (cat !== "all" && e.category !== cat) return false;
    if (statusFilter !== "all" && expenseStatus(e) !== statusFilter) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [expenses, q, from, to, cat, statusFilter]);

  const rows = paginate(filtered, page);
  const pages = totalPages(filtered);

  const remove = (id) => { const expense = expenses.find((item) => item.id === id); if (!expense || !window.confirm("Delete expense for " + expense.vendor + "? This cannot be undone.")) return; setExpenses(removeItem(KEYS.expenses, id)); setExpanded(null); };
  // Status changes (Pending → Received / Paid / Cancelled) persist to the store and refresh the UI immediately.
  const setStatus = (id, status) => {
    const expense = expenses.find((item) => item.id === id);
    if (!expense || !window.confirm("Change expense status from " + expenseStatus(expense) + " to " + status + "?")) return;
    const updated = expenses.map((x) => (x.id === id ? { ...x, status } : x));
    setExpenses(updated);
    saveList(KEYS.expenses, updated);
  };
  const save = (entry) => {
    const amount = Number(entry.amount);
    const [year, month, day] = String(entry.date || "").split("-").map(Number);
    const calendarDate = new Date(year, month - 1, day);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && calendarDate.getFullYear() === year && calendarDate.getMonth() === month - 1 && calendarDate.getDate() === day;
    if (!entry.vendor.trim()) { window.alert("Enter a vendor or payee name."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { window.alert("Enter an amount greater than zero."); return; }
    if (!validDate) { window.alert("Choose a valid expense date."); return; }
    if (!requestAction()) return;
    const next = [{ ...entry, currencyCode, id: genId("exp"), amount }, ...expenses];
    setExpenses(next); saveList(KEYS.expenses, next); setOpen(false);
  };
  const resetFilters = () => { setQ(""); setFrom(""); setTo(""); setCat("all"); setStatusFilter("all"); setPage(1); };

  const statusCls = (s) => s === "Paid" ? "bg-emerald-100 text-emerald-700" : s === "Received" ? "bg-blue-100 text-blue-700" : s === "Cancelled" ? "bg-slate-200 text-slate-500" : s === "Overdue" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700";

  return (
    <div className="space-y-5">
      {(() => { const used = Number(usage.expenses_monthly ?? usage.expenses ?? expenses.length); const limit = Number(limits.expenses_monthly ?? limits.expenses ?? 30); const pct = limit > 0 ? Math.min(100, used / limit * 100) : 100; return <div className="rounded-xl border border-[#E5E7EB] bg-white p-3"><div className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-slate-700">Expenses this cycle</span><span className="font-bold text-slate-600">{used}/{limit}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-[#6D28D9]"}`} style={{ width: `${pct}%` }} /></div>{pct >= 80 && <p className={`mt-1.5 text-[11px] ${pct >= 100 ? "text-rose-600" : "text-amber-600"}`}>{pct >= 100 ? "Plan limit reached" : "Usage limit warning"}</p>}{pct >= 100 && <button onClick={() => openPaywall("Expense limit reached for your current plan.")} className="mt-2 rounded-lg bg-[#6D28D9] px-3 py-1.5 text-xs font-bold text-white">Upgrade</button>}</div>; })()}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Monthly Expense" value={monthExp} gradient="bg-gradient-to-br from-[#E11D48] to-[#F43F5E]" icon={Wallet} badge="this month" />
        <SummaryCard label="Monthly Sales" value={monthSales} gradient="bg-gradient-to-br from-[#059669] to-[#10B981]" icon={TrendingUp} badge="this month" />
        <SummaryCard label={`Operating Difference · ${currencyCode}`} value={money2(net, currencyCode)} gradient={net >= 0 ? "bg-gradient-to-br from-[#6D28D9] to-[#7C3AED]" : "bg-gradient-to-br from-[#D97706] to-[#F59E0B]"} icon={PiggyBank} badge={net >= 0 ? "positive" : "negative"} />
      </div>
      {(hasOtherCurrencySales || hasOtherCurrencyExpenses || hasUnknownCurrencyExpenses || hasUnknownCurrencySales) && <p className="text-[11px] text-muted-foreground">Sales and expenses are grouped by their recorded currency. Operating difference uses only base-currency sales and expenses; records without a recorded currency are excluded. No FX conversion is performed.</p>}
      <p className="text-[11px] leading-relaxed text-muted-foreground">Operating difference is sales minus recorded expenses, not a complete accounting profit. It excludes cost of goods, taxes and other unrecorded adjustments.</p>
      {/* Net profit uses only base-currency sales and expenses; records without a recorded currency are excluded. The metric is labeled Operating Difference because it is not a complete accounting profit. */}

      <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#E5E7EB] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search vendor, category…" aria-label="Search expenses" className={`${inputCls} pl-9`} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="From" />
            <span className="text-slate-300">–</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="To" />
            <select value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }} className={`${inputCls} w-auto`}>
              <option value="all">All categories</option>
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className={`${inputCls} w-auto`}>
              <option value="all">All status</option>
              <option value="Paid">Paid</option>
              <option value="Received">Received</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Overdue">Overdue</option>
            </select>
            <button onClick={resetFilters} className="flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-2.5 py-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"><RotateCcw className="h-3.5 w-3.5" />Reset</button>
            {!isAccountant && <button onClick={() => setOpen(true)} className={btnAccent}><Plus className="h-3.5 w-3.5" />Record purchase</button>}
          </div>
        </div>

        {filtered.length === 0 ? (
          <Empty label="No expenses match your filters." />
        ) : (
          <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3 py-2.5">Vendor</th>
                  <th className="px-3 py-2.5">Category</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {rows.map((e) => {
                  const open = expanded === e.id;
                  const vendorLogs = expenses.filter((x) => x.vendor === e.vendor && x.id !== e.id);
                  return (
                    <Fragment key={e.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-3 py-3">
                          <button onClick={() => setExpanded(open ? null : e.id)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Expand">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-3 py-3 font-bold text-slate-900">{e.vendor}</td>
                        <td className="px-3 py-3 text-slate-500">{e.category}</td>
                        <td className="px-3 py-3 text-slate-500">{dateLabel(e.date)}</td>
                        <td className="px-3 py-3 text-right font-bold text-slate-900">{recordedExpenseAmount(e)}</td>
                        <td className="px-3 py-3">
                          <select value={e.status || "Unpaid"} onChange={(ev) => setStatus(e.id, ev.target.value)} aria-label={"Status for expense " + e.vendor} className={`cursor-pointer rounded-full border-0 px-2.5 py-1 text-[10px] font-bold uppercase outline-none ${statusCls(expenseStatus(e))}`}>
                            <option value="Pending">Pending</option>
                            <option value="Unpaid">Unpaid</option>
                            <option value="Received">Received</option>
                            <option value="Paid">Paid</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => remove(e.id)} className="rounded-lg border border-[#E5E7EB] p-1.5 text-red-500 hover:bg-red-50" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/60">
                          <td />
                          <td colSpan={6} className="px-3 py-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Bill details</p>
                                <div className="space-y-1 rounded-lg bg-white px-3 py-2 text-[11px]">
                                  <div className="flex justify-between"><span className="text-slate-400">Method</span><span className="font-medium text-slate-700">{e.method || "—"}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-400">Status</span><span className="font-medium text-slate-700">{e.status}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-400">Notes</span><span className="font-medium text-slate-700">{e.notes || "—"}</span></div>
                                </div>
                              </div>
                              <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Vendor history ({vendorLogs.length} other bill{vendorLogs.length !== 1 ? "s" : ""})</p>
                                {vendorLogs.length === 0 ? (
                                  <p className="rounded-lg bg-white px-3 py-2 text-[11px] text-slate-400">No other bills from this vendor.</p>
                                ) : (
                                  <div className="space-y-1">
                                    {vendorLogs.slice(0, 4).map((v) => (
                                      <div key={v.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 text-[11px]">
                                        <span className="text-slate-700">{dateLabel(v.date)} · {v.category}</span>
                                        <span className="font-semibold text-slate-900">{recordedExpenseAmount(v)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-2.5 p-3 md:hidden">
            {rows.map((expense) => <article key={expense.id} className="rounded-xl border border-slate-200 p-3.5">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-[13px] font-bold text-slate-900">{expense.vendor}</p><p className="mt-0.5 text-[10px] text-slate-500">{expense.category} · {dateLabel(expense.date)}</p></div><p className="shrink-0 text-[13px] font-bold text-slate-900">{recordedExpenseAmount(expense)}</p></div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3"><span className={"rounded-full px-2.5 py-1 text-[10px] font-bold " + statusCls(expenseStatus(expense))}>{expenseStatus(expense)}</span><div className="flex items-center gap-2"><select value={expense.status || "Unpaid"} onChange={(event) => setStatus(expense.id, event.target.value)} aria-label={"Change status for " + expense.vendor} className="min-h-9 max-w-[125px] rounded-lg border border-slate-200 bg-white px-2 text-[10px]"><option value="Pending">Pending</option><option value="Unpaid">Unpaid</option><option value="Received">Received</option><option value="Paid">Paid</option><option value="Cancelled">Cancelled</option></select><button type="button" onClick={() => remove(expense.id)} aria-label={"Delete expense for " + expense.vendor} className="min-h-9 rounded-lg border border-rose-100 px-3 text-[11px] font-semibold text-rose-700">Delete</button></div></div>
              {expense.notes && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{expense.notes}</p>}
            </article>)}
          </div>
          </>
        )}

        <div className="flex items-center justify-between border-t border-[#E5E7EB] px-4 py-3 text-[11px] text-slate-500">
          <span>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 font-semibold text-slate-500 disabled:opacity-40 hover:bg-slate-50">Prev</button>
            <span className="font-mono-ui">Page {page}/{pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 font-semibold text-slate-500 disabled:opacity-40 hover:bg-slate-50">Next</button>
          </div>
        </div>
      </div>

      {open && <ExpenseModal currencyCode={currencyCode} onClose={() => setOpen(false)} onSave={save} />}
    </div>
  );
}

function ExpenseModal({ currencyCode, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...blank, date: localDate() }));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="expense-modal-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-[480px] overflow-y-auto overscroll-contain rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 id="expense-modal-title" className="text-lg font-bold text-slate-900">Record a purchase</h3><button type="button" onClick={onClose} aria-label="Close purchase form" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid gap-3">
          <label className="block text-[12px] font-semibold text-slate-500">Vendor name<input className={inputCls} value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Vendor / supplier" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-semibold text-slate-500">Category<select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label className="block text-[12px] font-semibold text-slate-500">Amount ({currencyCode})<input type="number" className={inputCls} value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" /></label>
            <label className="block text-[12px] font-semibold text-slate-500">Date<input type="date" className={inputCls} value={form.date} onChange={(e) => set("date", e.target.value)} /></label>
            <label className="block text-[12px] font-semibold text-slate-500">Status<select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}><option value="Paid">Paid</option><option value="Unpaid">Unpaid</option></select></label>
            <label className="block text-[12px] font-semibold text-slate-500">Method<select className={inputCls} value={form.method} onChange={(e) => set("method", e.target.value)}><option>Bank Transfer</option><option>Cash</option><option>UPI</option><option>Cheque</option><option>Card</option></select></label>
            <label className="block text-[12px] font-semibold text-slate-500 sm:col-span-2">Notes<textarea className={`${inputCls} min-h-[56px]`} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional reference / bill no." /></label>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={() => onSave(form)} className={btnAccent}>Save purchase</button></div>
      </div>
    </div>
  );
}