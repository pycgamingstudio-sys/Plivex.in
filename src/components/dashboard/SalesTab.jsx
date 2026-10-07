import { backend as db } from '@/api/backendClient';

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Eye, Trash2, MessageCircle, ArrowRight, X, Search, ChevronDown, ChevronRight, Paperclip, PenLine, FileText, CheckCircle2, Clock, Receipt as ReceiptIcon, RotateCcw, Bell } from "lucide-react";
import { KEYS, loadList, saveList, removeItem, genId, loadState, saveState } from "@/lib/stores";
import { inputCls, btnGhost } from "@/lib/ui";
import { money2, dateLabel, btnAccent, subPill, statusBadge, Empty } from "@/lib/dashboardData";
import { paginate, totalPages, PAGE_SIZE } from "@/lib/paging";
import { usePaywall } from "@/lib/paywall";
import { useRole } from "@/lib/roles";

import { trackStaffAction } from "@/lib/staffTracking";
import SummaryCard from "@/components/dashboard/SummaryCard";

const BANKS = ["HDFC Bank · 501000123456789", "ICICI Bank · 623400987654321", "State Bank of India · 30012345678901", "Axis Bank · 910000456789012"];

export default function SalesTab({ intent, onConsumeIntent }) {
  const { requestAction } = usePaywall();
  const { isAccountant } = useRole();
  const [sub, setSub] = useState("invoices");
  const [invoices, setInvoices] = useState(() => loadList(KEYS.history, { includeCancelled: true }));
  const [quotations, setQuotations] = useState(() => loadList(KEYS.quotations));
  const [paylog] = useState(() => loadList(KEYS.paymentLogs));
  const [view, setView] = useState(null);
  const [qOpen, setQOpen] = useState(false);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { if (intent === "new-quotation") { setSub("quotations"); setQOpen(true); onConsumeIntent(); } }, [intent]);

  const statusOf = (it) => (it.status === "Paid" || it.status === "Pending" ? it.status : (paylog.some((l) => l.status === "paid" && l.invoiceNumber === it.number) ? "Paid" : "Pending"));

  const filteredInv = useMemo(() => invoices.filter((it) => {
    const hay = `${it.clientName} ${it.number} ${it.businessName}`.toLowerCase();
    if (q && !hay.includes(q.toLowerCase())) return false;
    if (from && new Date(it.issueDate) < new Date(from)) return false;
    if (to && new Date(it.issueDate) > new Date(to)) return false;
    if (statusFilter !== "all" && statusOf(it) !== statusFilter) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [invoices, q, from, to, statusFilter, paylog]);

  const filteredQuo = useMemo(() => quotations.filter((qt) => {
    const hay = `${qt.clientName} ${qt.number}`.toLowerCase();
    if (q && !hay.includes(q.toLowerCase())) return false;
    if (from && new Date(qt.date) < new Date(from)) return false;
    if (to && new Date(qt.date) > new Date(to)) return false;
    return true;
  }), [quotations, q, from, to]);

  const list = sub === "invoices" ? filteredInv : filteredQuo;
  const rows = paginate(list, page);
  const pages = totalPages(list);

  const delInv = (id) => { setInvoices(removeItem(KEYS.history, id)); setExpanded(null); };
  const delQuo = (id) => { setQuotations(removeItem(KEYS.quotations, id)); setExpanded(null); };
  const sendReminder = async (it) => {
    const clients = loadList(KEYS.clients);
    const match = clients.find((c) => (c.name || "").toLowerCase() === (it.clientName || "").toLowerCase());
    const email = (match && match.email) || window.prompt(`Enter client email to send a payment reminder for ${it.clientName || it.number}:`);
    if (!email) return;
    const es = loadState("invoicepulse:emailSettings", {});
    try {
      await db.functions.invoke("sendPaymentReminder", { to: email, clientName: it.clientName, invoiceNumber: it.number, amount: money2(it.total, it.currency), dueDate: it.dueDate, senderEmail: es.senderEmail, appPassword: es.appPassword });
      alert("Payment reminder sent to " + email);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Failed to send reminder";
      alert("Reminder failed: " + msg);
    }
  };
  const share = (it) => { if (!requestAction()) return; const msg = `Hello ${it.clientName || "there"}, your invoice ${it.number || ""} for ${money2(it.total, it.currency)} from Plivex is ready.`; window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank"); };
  const convert = (qt) => { if (!requestAction()) return; const draft = loadState(KEYS.draft, {}); saveState(KEYS.draft, { ...draft, client: { ...draft.client, name: qt.clientName }, number: qt.number, items: qt.items || draft.items, taxRate: qt.taxRate ?? draft.taxRate }); navigate("/invoice-builder"); };
  const saveQuotation = (qt) => {
    if (!requestAction()) return;
    const next = [qt, ...quotations];
    setQuotations(next); saveList(KEYS.quotations, next); setQOpen(false);
    trackStaffAction({ label: `Quotation ${qt.number} created for ${qt.clientName}`, type: "quotation" });
  };
  const resetFilters = () => { setQ(""); setFrom(""); setTo(""); setStatusFilter("all"); setPage(1); };
  const toggleStatus = (it) => {
    if (sub === "invoices") {
      const next = statusOf(it) === "Paid" ? "Pending" : "Paid";
      const updated = invoices.map((x) => (x.id === it.id ? { ...x, status: next } : x));
      setInvoices(updated); saveList(KEYS.history, updated);
    } else {
      const next = it.status === "sent" ? "draft" : "sent";
      const updated = quotations.map((x) => (x.id === it.id ? { ...x, status: next } : x));
      setQuotations(updated); saveList(KEYS.quotations, updated);
    }
  };

  const paidCount = invoices.filter((it) => statusOf(it) === "Paid").length;
  const pendingCount = invoices.length - paidCount;
  const totalInvoiced = invoices.reduce((s, it) => s + Number(it.total || 0), 0);
  const totalQuotes = quotations.length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total Invoiced" value={money2(totalInvoiced)} gradient="bg-gradient-to-br from-[#6D28D9] to-[#7C3AED]" icon={ReceiptIcon} badge={`${invoices.length} inv`} />
        <SummaryCard label="Paid" value={money2(invoices.filter((it) => statusOf(it) === "Paid").reduce((s, it) => s + Number(it.total || 0), 0))} gradient="bg-gradient-to-br from-[#059669] to-[#10B981]" icon={CheckCircle2} badge={`${paidCount} paid`} />
        <SummaryCard label="Pending" value={money2(invoices.filter((it) => statusOf(it) === "Pending").reduce((s, it) => s + Number(it.total || 0), 0))} gradient="bg-gradient-to-br from-[#D97706] to-[#F59E0B]" icon={Clock} badge={`${pendingCount} due`} />
        <SummaryCard label="Quotations" value={String(totalQuotes)} gradient="bg-gradient-to-br from-[#2563EB] to-[#3B82F6]" icon={FileText} badge="quotes" />
      </div>

      <div className="flex gap-1.5 rounded-xl border border-[#E5E7EB] bg-white p-1.5">
        <button onClick={() => { setSub("invoices"); setPage(1); setExpanded(null); }} className={subPill(sub, "invoices")}>All Invoices</button>
        <button onClick={() => { setSub("quotations"); setPage(1); setExpanded(null); }} className={subPill(sub, "quotations")}>Quotations</button>
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#E5E7EB] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search client, invoice no…" className={`${inputCls} pl-9`} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="From date" />
            <span className="text-slate-300">–</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="To date" />
            {sub === "invoices" && (
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className={`${inputCls} w-auto`}>
                <option value="all">All status</option>
                <option value="Paid">Paid</option>
                <option value="Pending">Pending</option>
              </select>
            )}
            <button onClick={resetFilters} className="flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-2.5 py-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"><RotateCcw className="h-3.5 w-3.5" />Reset</button>
            {sub === "invoices" ? (
              !isAccountant ? <button onClick={() => navigate("/invoice-builder")} className={btnAccent}><Plus className="h-3.5 w-3.5" />New invoice</button> : null
            ) : (
              <button onClick={() => setQOpen(true)} className={btnAccent}><Plus className="h-3.5 w-3.5" />New quotation</button>
            )}
          </div>
        </div>

        {list.length === 0 ? (
          <Empty label={sub === "invoices" ? "No invoices match your filters." : "No quotations match your filters."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3 py-2.5">Client</th>
                  <th className="px-3 py-2.5">Number</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {rows.map((it) => {
                  const open = expanded === it.id;
                  const logs = paylog.filter((l) => l.invoiceNumber === it.number);
                  return (
                    <>
                      <tr key={it.id} className="hover:bg-slate-50">
                        <td className="px-3 py-3">
                          <button onClick={() => setExpanded(open ? null : it.id)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Expand">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-3 py-3 font-bold text-slate-900">{it.clientName || "Client"}</td>
                        <td className="px-3 py-3 font-mono-ui text-slate-500">{it.number || "—"}</td>
                        <td className="px-3 py-3 text-slate-500">{dateLabel(sub === "invoices" ? it.issueDate : it.date)}</td>
                        <td className="px-3 py-3 text-right font-bold text-slate-900">{money2(it.total, it.currency)}</td>
                        <td className="px-3 py-3"><button onClick={() => toggleStatus(it)} title="Toggle status" className={statusBadge(sub === "invoices" ? statusOf(it) : (it.status === "sent" ? "Sent" : "Draft")) + " cursor-pointer transition-opacity hover:opacity-80"}>{sub === "invoices" ? statusOf(it) : (it.status === "sent" ? "Sent" : "Draft")}</button></td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {sub === "invoices" ? (
                              <>
                                <button onClick={() => setView(it)} className="rounded-lg border border-[#E5E7EB] p-1.5 text-slate-500 hover:bg-slate-50" aria-label="View"><Eye className="h-3.5 w-3.5" /></button>
                                <button onClick={() => share(it)} className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#25D366] hover:bg-slate-50" aria-label="Share"><MessageCircle className="h-3.5 w-3.5" /></button>
                              {statusOf(it) === "Pending" && <button onClick={() => sendReminder(it)} className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#6D28D9] hover:bg-slate-50" aria-label="Send payment reminder"><Bell className="h-3.5 w-3.5" /></button>}
                              </>
                            ) : (
                              <button onClick={() => convert(it)} className="inline-flex items-center gap-1 rounded-lg bg-[#6D28D9] px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-[#7C3AED]"><ArrowRight className="h-3 w-3" />Convert</button>
                            )}
                            <button onClick={() => (sub === "invoices" ? delInv(it.id) : delQuo(it.id))} className="rounded-lg border border-[#E5E7EB] p-1.5 text-red-500 hover:bg-red-50" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/60">
                          <td />
                          <td colSpan={6} className="px-3 py-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Line items</p>
                                <div className="space-y-1.5">
                                  {(it.items || []).map((li, i) => (
                                    <div key={i} className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 text-[11px]">
                                      <span className="text-slate-700">{li.description || "Item"}</span>
                                      <span className="font-semibold text-slate-900">{li.quantity || 1} × {money2(li.rate)}</span>
                                    </div>
                                  ))}
                                  {(!it.items || it.items.length === 0) && <p className="text-[11px] text-slate-400">No item breakdown stored.</p>}
                                </div>
                              </div>
                              <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Payment history</p>
                                {logs.length === 0 ? (
                                  <p className="rounded-lg bg-white px-3 py-2 text-[11px] text-slate-400">No payments recorded yet.</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {logs.map((l) => (
                                      <div key={l.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 text-[11px]">
                                        <span className="text-slate-700">{dateLabel(l.date)} · {l.method || "—"}</span>
                                        <span className={statusBadge(l.status === "paid" ? "Paid" : "Pending")}>{l.status}</span>
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
          <span>{list.length} record{list.length !== 1 ? "s" : ""}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 font-semibold text-slate-500 disabled:opacity-40 hover:bg-slate-50">Prev</button>
            <span className="font-mono-ui">Page {page}/{pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 font-semibold text-slate-500 disabled:opacity-40 hover:bg-slate-50">Next</button>
          </div>
        </div>
      </div>

      {view && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setView(null)}>
          <div className="w-full max-w-[420px] rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-wider text-[#6D28D9]">{view.number || "INV-000"}</p><h3 className="mt-1 text-lg font-bold text-slate-900">{view.clientName || "Client"}</h3></div><button onClick={() => setView(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
              <div><p className="text-slate-400">Business</p><p className="font-semibold text-slate-700">{view.businessName || "—"}</p></div>
              <div><p className="text-slate-400">Issue date</p><p className="font-semibold text-slate-700">{dateLabel(view.issueDate)}</p></div>
              <div><p className="text-slate-400">Items</p><p className="font-semibold text-slate-700">{view.itemCount || 0}</p></div>
              <div><p className="text-slate-400">Status</p><span className={statusBadge(statusOf(view))}>{statusOf(view)}</span></div>
              <div><p className="text-slate-400">CGST</p><p className="font-semibold text-slate-700">{money2(view.cgst, view.currency)}</p></div>
              <div><p className="text-slate-400">SGST</p><p className="font-semibold text-slate-700">{money2(view.sgst, view.currency)}</p></div>
              <div><p className="text-slate-400">IGST</p><p className="font-semibold text-slate-700">{money2(view.igst, view.currency)}</p></div>
              <div><p className="text-slate-400">Total</p><p className="font-bold text-[#6D28D9]">{money2(view.total, view.currency)}</p></div>
            </div>
            <button onClick={() => { setView(null); navigate("/invoice-builder"); }} className="mt-4 w-full rounded-xl bg-[#6D28D9] py-2.5 text-[12px] font-bold text-white hover:bg-[#7C3AED]">Open invoice builder</button>
          </div>
        </div>
      )}

      {qOpen && <QuotationModal onClose={() => setQOpen(false)} onSave={saveQuotation} />}
    </div>
  );
}

function QuotationModal({ onClose, onSave }) {
  const [form, setForm] = useState({ clientName: "", clientEmail: "", taxRate: 18, items: [{ id: "qi1", description: "", quantity: 1, rate: "" }], shipping: "", flatDiscount: "", pctDiscount: "", terms: "Payment due within 15 days of issue. Goods remain property of seller until paid in full.", bank: "", notes: "", attachmentName: "", signature: "" });
  const [adv, setAdv] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (id, k, v) => setForm((f) => ({ ...f, items: f.items.map((i) => (i.id === id ? { ...i, [k]: v } : i)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { id: `qi-${Date.now()}`, description: "", quantity: 1, rate: "" }] }));
  const removeItem = (id) => setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((i) => i.id !== id) : f.items }));
  const onAttach = (e) => { const f = e.target.files?.[0]; if (f) set("attachmentName", f.name); };

  const subtotal = form.items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0);
  const pctDisc = subtotal * (Number(form.pctDiscount) || 0) / 100;
  const flatDisc = Number(form.flatDiscount) || 0;
  const afterDisc = Math.max(0, subtotal - pctDisc - flatDisc);
  const tax = afterDisc * (Number(form.taxRate) || 0) / 100;
  const shipping = Number(form.shipping) || 0;
  const total = afterDisc + tax + shipping;

  const save = () => {
    if (!form.clientName.trim()) return;
    onSave({ id: genId("quo"), number: `QTN-${String(Date.now()).slice(-4)}`, clientName: form.clientName, clientEmail: form.clientEmail, date: new Date().toISOString().slice(0, 10), total, status: "sent", taxRate: Number(form.taxRate), items: form.items, shipping, flatDiscount: flatDisc, pctDiscount: Number(form.pctDiscount) || 0, terms: form.terms, bank: form.bank, notes: form.notes, attachmentName: form.attachmentName, signature: form.signature });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-slate-900">New quotation</h3><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>

        <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-[#6D28D9]">Basic details</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px] font-semibold text-slate-500">Client name<input className={inputCls} value={form.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="Client name" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Client email<input className={inputCls} value={form.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} placeholder="email@client.com" /></label>
        </div>

        <div className="mt-3 rounded-xl border border-[#E5E7EB] p-3">
          <div className="hidden grid-cols-[1fr_56px_84px_28px] gap-2 px-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 sm:grid"><span>Description</span><span>Qty</span><span>Rate</span><span /></div>
          {form.items.map((it) => (
            <div key={it.id} className="mb-2 grid grid-cols-[1fr_56px_84px_28px] items-center gap-2">
              <input className={inputCls + " mt-0"} value={it.description} onChange={(e) => setItem(it.id, "description", e.target.value)} placeholder="Description" />
              <input type="number" className={inputCls + " mt-0"} value={it.quantity} onChange={(e) => setItem(it.id, "quantity", Number(e.target.value))} />
              <input type="number" className={inputCls + " mt-0"} value={it.rate} onChange={(e) => setItem(it.id, "rate", e.target.value)} placeholder="Rate" />
              <button onClick={() => removeItem(it.id)} className="rounded-md p-1.5 text-red-500 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button onClick={addItem} className="text-[11px] font-bold text-[#6D28D9] hover:underline">+ Add line</button>
        </div>

        <label className="mt-3 block text-[12px] font-semibold text-slate-500">GST rate<select className={inputCls} value={form.taxRate} onChange={(e) => set("taxRate", e.target.value)}>{[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>

        <button onClick={() => setAdv((v) => !v)} className="mt-4 flex w-full items-center justify-between rounded-xl border border-[#E5E7EB] bg-slate-50 px-3 py-2.5 text-[12px] font-bold text-slate-700 hover:bg-slate-100">
          <span>Advanced details {adv ? "" : "(shipping, discounts, terms, bank, signature)"}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${adv ? "rotate-180" : ""}`} />
        </button>
        {adv && (
          <div className="mt-2 grid gap-3 rounded-xl border border-[#E5E7EB] p-3 sm:grid-cols-2">
            <label className="block text-[12px] font-semibold text-slate-500">Shipping / handling (₹)<input type="number" className={inputCls} value={form.shipping} onChange={(e) => set("shipping", e.target.value)} placeholder="0" /></label>
            <label className="block text-[12px] font-semibold text-slate-500">Flat discount (₹)<input type="number" className={inputCls} value={form.flatDiscount} onChange={(e) => set("flatDiscount", e.target.value)} placeholder="0" /></label>
            <label className="block text-[12px] font-semibold text-slate-500">Percentage discount (%)<input type="number" className={inputCls} value={form.pctDiscount} onChange={(e) => set("pctDiscount", e.target.value)} placeholder="0" /></label>
            <label className="block text-[12px] font-semibold text-slate-500">Bank account<select className={inputCls} value={form.bank} onChange={(e) => set("bank", e.target.value)}><option value="">Select account</option>{BANKS.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
            <label className="block text-[12px] font-semibold text-slate-500 sm:col-span-2">Terms & conditions<textarea className={`${inputCls} min-h-[72px]`} value={form.terms} onChange={(e) => set("terms", e.target.value)} /></label>
            <label className="block text-[12px] font-semibold text-slate-500 sm:col-span-2">Notes<textarea className={`${inputCls} min-h-[56px]`} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional note for the client" /></label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#E5E7EB] px-3 py-2 text-[11px] font-semibold text-slate-500 hover:border-[#6D28D9] hover:text-[#6D28D9]"><Paperclip className="h-3.5 w-3.5" />{form.attachmentName || "Add attachment"}<input type="file" className="hidden" onChange={onAttach} /></label>
            <label className="flex items-center gap-2 rounded-lg border border-dashed border-[#E5E7EB] px-3 py-2 text-[11px] font-semibold text-slate-500"><PenLine className="h-3.5 w-3.5" />Signature<input className="flex-1 bg-transparent text-[11px] font-medium text-slate-700" value={form.signature} onChange={(e) => set("signature", e.target.value)} placeholder="Type signature" /></label>
          </div>
        )}

        <div className="mt-4 space-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[12px]">
          <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{money2(subtotal)}</span></div>
          {(pctDisc > 0 || flatDisc > 0) && <div className="flex justify-between text-slate-500"><span>Discount</span><span>-{money2(pctDisc + flatDisc)}</span></div>}
          <div className="flex justify-between text-slate-500"><span>GST ({form.taxRate}%)</span><span>{money2(tax)}</span></div>
          {shipping > 0 && <div className="flex justify-between text-slate-500"><span>Shipping</span><span>{money2(shipping)}</span></div>}
          <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold"><span className="text-slate-700">Total</span><span className="text-[#6D28D9]">{money2(total)}</span></div>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={save} className={btnAccent}>Save quotation</button></div>
      </div>
    </div>
  );
}