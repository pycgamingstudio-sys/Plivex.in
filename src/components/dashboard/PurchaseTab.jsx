import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X, Search, ChevronDown, ChevronRight, RotateCcw, Wallet, TrendingUp, PiggyBank } from "lucide-react";
import { KEYS, loadList, saveList, removeItem, genId } from "@/lib/stores";
import { inputCls, btnGhost } from "@/lib/ui";
import { money2, dateLabel, btnAccent, Empty } from "@/lib/dashboardData";
import { paginate, totalPages } from "@/lib/paging";
import { usePaywall } from "@/lib/paywall";
import { useRole } from "@/lib/roles";
import SummaryCard from "@/components/dashboard/SummaryCard";

const CATS = ["Rent", "Raw Materials", "Utilities", "Salary", "Logistics", "Software", "Marketing", "Other"];
const blank = { vendor: "", category: "Raw Materials", amount: "", date: new Date().toISOString().slice(0, 10), status: "Unpaid", method: "Bank Transfer", notes: "" };

export default function PurchaseTab({ intent, onConsumeIntent }) {
  const { requestAction } = usePaywall();
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
  const cur = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthExp = expenses.filter((e) => new Date(e.date) >= cur).reduce((s, e) => s + Number(e.amount || 0), 0);
  const monthSales = loadList(KEYS.history).filter((it) => { const d = new Date(it.createdDate || it.issueDate); return d >= cur; }).reduce((s, it) => s + Number(it.total || 0), 0);
  const net = monthSales - monthExp;

  const expenseStatus = (e) => {
    if (e.status === "Paid" || e.status === "Received" || e.status === "Cancelled") return e.status;
    const overdue = new Date(e.date) < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    return overdue ? "Overdue" : (e.status || "Unpaid");
  };

  const filtered = useMemo(() => expenses.filter((e) => {
    const hay = `${e.vendor} ${e.category} ${e.notes}`.toLowerCase();
    if (q && !hay.includes(q.toLowerCase())) return false;
    if (from && new Date(e.date) < new Date(from)) return false;
    if (to && new Date(e.date) > new Date(to)) return false;
    if (cat !== "all" && e.category !== cat) return false;
    if (statusFilter !== "all" && expenseStatus(e) !== statusFilter) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [expenses, q, from, to, cat, statusFilter]);

  const rows = paginate(filtered, page);
  const pages = totalPages(filtered);

  const remove = (id) => { setExpenses(removeItem(KEYS.expenses, id)); setExpanded(null); };
  // Status changes (Pending → Received / Paid / Cancelled) persist to the store and refresh the UI immediately.
  const setStatus = (id, status) => {
    const updated = expenses.map((x) => (x.id === id ? { ...x, status } : x));
    setExpenses(updated);
    saveList(KEYS.expenses, updated);
  };
  const save = (entry) => {
    if (!entry.vendor.trim() || !entry.amount) return;
    if (!requestAction()) return;
    const next = [{ ...entry, id: genId("exp"), amount: Number(entry.amount) || 0 }, ...expenses];
    setExpenses(next); saveList(KEYS.expenses, next); setOpen(false);
  };
  const resetFilters = () => { setQ(""); setFrom(""); setTo(""); setCat("all"); setStatusFilter("all"); setPage(1); };

  const statusCls = (s) => s === "Paid" ? "bg-emerald-100 text-emerald-700" : s === "Received" ? "bg-blue-100 text-blue-700" : s === "Cancelled" ? "bg-slate-200 text-slate-500" : s === "Overdue" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Monthly Expense" value={money2(monthExp)} gradient="bg-gradient-to-br from-[#E11D48] to-[#F43F5E]" icon={Wallet} badge="this month" />
        <SummaryCard label="Monthly Sales" value={money2(monthSales)} gradient="bg-gradient-to-br from-[#059669] to-[#10B981]" icon={TrendingUp} badge="this month" />
        <SummaryCard label="Net Profit" value={money2(net)} gradient={net >= 0 ? "bg-gradient-to-br from-[#6D28D9] to-[#7C3AED]" : "bg-gradient-to-br from-[#D97706] to-[#F59E0B]"} icon={PiggyBank} badge={net >= 0 ? "surplus" : "deficit"} />
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#E5E7EB] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search vendor, category…" className={`${inputCls} pl-9`} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="From" />
            <span className="text-slate-300">–</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="To" />
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
          <div className="overflow-x-auto">
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
                    <>
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="px-3 py-3">
                          <button onClick={() => setExpanded(open ? null : e.id)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Expand">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-3 py-3 font-bold text-slate-900">{e.vendor}</td>
                        <td className="px-3 py-3 text-slate-500">{e.category}</td>
                        <td className="px-3 py-3 text-slate-500">{dateLabel(e.date)}</td>
                        <td className="px-3 py-3 text-right font-bold text-slate-900">{money2(e.amount)}</td>
                        <td className="px-3 py-3">
                          <select value={e.status || "Unpaid"} onChange={(ev) => setStatus(e.id, ev.target.value)} aria-label="Order status" className={`cursor-pointer rounded-full border-0 px-2.5 py-1 text-[10px] font-bold uppercase outline-none ${statusCls(expenseStatus(e))}`}>
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
                                        <span className="font-semibold text-slate-900">{money2(v.amount)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
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

      {open && <ExpenseModal onClose={() => setOpen(false)} onSave={save} />}
    </div>
  );
}

function ExpenseModal({ onClose, onSave }) {
  const [form, setForm] = useState(blank);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[480px] rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-slate-900">Record a purchase</h3><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid gap-3">
          <label className="block text-[12px] font-semibold text-slate-500">Vendor name<input className={inputCls} value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Vendor / supplier" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-semibold text-slate-500">Category<select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label className="block text-[12px] font-semibold text-slate-500">Amount (₹)<input type="number" className={inputCls} value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" /></label>
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