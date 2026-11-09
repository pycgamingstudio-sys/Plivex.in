import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, FilePlus2, ShoppingCart, Users, UserPlus, ArrowRight, Phone, Mail, HelpCircle, Package, UsersRound, AlertTriangle, Settings2, X, Check, BellRing, Send } from "lucide-react";
import { KEYS, useLocalState, loadList } from "@/lib/stores";
import { InvoiceArt, QuoteArt, ExpenseArt, CrmArt, LeadArt, StockArt, TeamArt } from "@/components/dashboard/CardArt";
import OwnerMasterControl from "@/components/dashboard/OwnerMasterControl";
import OwnerTrackingWidgets from "@/components/dashboard/OwnerTrackingWidgets";
import PlanStatusCard from "@/components/PlanStatusCard";
import { usePaywall } from "@/lib/paywall";
import { supabase } from "@/api/backendClient";

const CARD_KEY = "invoicepulse:cardVisibility";
const DEFAULT_VIS = { invoices: true, quotations: true, expenses: true, crm: true, leads: true, stock: true, team: true };

// Strict per-role dashboard card visibility. A role can never see cards outside its allowlist.
const ROLE_CARD_ACCESS = {
  admin: ["invoices", "quotations", "expenses", "crm", "leads", "stock", "team"],
  manager: ["invoices", "quotations", "crm", "leads", "team"],
  employee: ["invoices", "quotations", "crm", "leads"],
  accountant: ["invoices", "quotations", "expenses"],
  storekeeper: ["stock"],
};

export default function DashboardTab({ onNavigate, onCreateInvoice, role, teamUnlocked }) {
  const isAdmin = role === "admin";
  const { limits, usage } = usePaywall();
  const [profile] = useLocalState(KEYS.businessProfile, { name: "", address: "", gstin: "", email: "", phone: "", logo: "" });
  const [vis, setVis] = useLocalState(CARD_KEY, DEFAULT_VIS);
  const [visOpen, setVisOpen] = useState(false);
  const [reminderItems, setReminderItems] = useState([]);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [reminderBusyId, setReminderBusyId] = useState("");
  const [reminderNotice, setReminderNotice] = useState("");
  const canConfirmReminders = ["admin", "manager", "accountant"].includes(role);

  useEffect(() => {
    if (!canConfirmReminders) return undefined;
    let active = true;
    const loadReminders = async () => {
      setReminderLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      const { data: events, error } = await supabase.from("invoice_reminder_events")
        .select("id,invoice_id,stage,scheduled_for,recipient_email,status")
        .eq("status", "on_hold").lte("scheduled_for", today)
        .order("scheduled_for", { ascending: true }).limit(8);
      if (!active) return;
      if (error || !events?.length) {
        setReminderItems([]);
        setReminderLoading(false);
        return;
      }
      const invoiceIds = [...new Set(events.map((event) => event.invoice_id))];
      const { data: invoices } = await supabase.from("invoices")
        .select("id,number,client_name,total,status,is_draft,reminder_enabled")
        .in("id", invoiceIds);
      if (!active) return;
      const byId = new Map((invoices || []).map((invoice) => [invoice.id, invoice]));
      setReminderItems(events.filter((event) => {
        const invoice = byId.get(event.invoice_id);
        return invoice && String(invoice.status).toLowerCase() !== "paid" &&
          String(invoice.status).toLowerCase() !== "cancelled" && !invoice.is_draft && invoice.reminder_enabled;
      }).map((event) => ({ ...event, invoice: byId.get(event.invoice_id) })));
      setReminderLoading(false);
    };
    loadReminders();
    const timer = window.setInterval(loadReminders, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [role]);

  const confirmReminder = async (event) => {
    if (!window.confirm("Confirm that this customer has still NOT paid? Plivex will send the reminder email now.")) return;
    setReminderBusyId(event.id);
    setReminderNotice("");
    try {
      const { data, error } = await supabase.functions.invoke("confirm-payment-reminder", { body: { eventId: event.id } });
      if (error) throw error;
      if (!data?.emailSent) throw new Error(data?.error || "Reminder email was not sent.");
      setReminderItems((items) => items.filter((item) => item.id !== event.id));
      setReminderNotice("Reminder email sent.");
    } catch (error) {
      setReminderNotice(error?.message || "Could not send this reminder.");
    } finally {
      setReminderBusyId("");
    }
  };
  const fields = ["name", "address", "gstin", "email", "phone", "logo"];
  const done = fields.filter((f) => profile[f] && String(profile[f]).trim()).length;
  const pct = Math.round((done / fields.length) * 100);

  const stock = loadList(KEYS.stock);
  const lowStock = stock.filter((p) => (Number(p.quantity) || 0) <= (Number(p.lowStock) || 5)).length;

  const quotaCards = [
    { id: "invoices", label: "Invoices", used: Number(usage.invoices_monthly ?? usage.invoices ?? loadList(KEYS.history).length), limit: Number(limits.invoices_monthly ?? limits.invoices ?? 30) },
    { id: "quotations", label: "Quotations", used: Number(usage.quotations_monthly ?? usage.quotations ?? loadList(KEYS.quotations).length), limit: limits.quotations_monthly ?? limits.quotations },
    { id: "expenses", label: "Expenses", used: Number(usage.expenses_monthly ?? usage.expenses ?? loadList(KEYS.expenses).length), limit: limits.expenses_monthly ?? limits.expenses },
    { id: "stock", label: "Stock items", used: Number(usage.stock ?? usage.stock_total ?? stock.length), limit: Number(limits.stock ?? limits.stock_total ?? 20) },
  ];

  const cards = [
    { id: "invoices", title: "Invoices", desc: "Bill clients with GST-ready, print-perfect PDFs in under a minute.", icon: FileText, Art: InvoiceArt, gradient: "bg-gradient-to-br from-[#EDE9FE] to-[#DDD6FE]", cta: "+ Create New Invoice", onClick: onCreateInvoice, stat: loadList(KEYS.history).length },
    { id: "quotations", title: "Quotations", desc: "Send estimates clients can approve, then convert to invoices in one click.", icon: FilePlus2, Art: QuoteArt, gradient: "bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE]", cta: "+ Create New Quotation", onClick: () => onNavigate("sales", "new-quotation"), stat: loadList(KEYS.quotations).length },
    { id: "expenses", title: "Expenses", desc: "Track vendor bills and purchases to see your real net profit.", icon: ShoppingCart, Art: ExpenseArt, gradient: "bg-gradient-to-br from-[#DCFCE7] to-[#BBF7D0]", cta: "+ Record New Purchase", onClick: () => onNavigate("purchase", "new-expense") },
    { id: "crm", title: "Client CRM", desc: "Save client details once and reuse them forever across invoices.", icon: Users, Art: CrmArt, gradient: "bg-gradient-to-br from-[#FAE8FF] to-[#F5D0FE]", cta: "+ Add New Client", onClick: () => onNavigate("crm", "new-client"), stat: loadList(KEYS.clients).length },
    { id: "leads", title: "Lead Tracker", desc: "Move leads from new to won and never miss a follow-up.", icon: UserPlus, Art: LeadArt, gradient: "bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A]", cta: "+ Add New Lead", onClick: () => onNavigate("crm", "new-lead"), stat: loadList(KEYS.leads).length },
    { id: "stock", title: "Stock Inventory", desc: "Manage products and watch quantities auto-deduct on every invoice.", icon: Package, Art: StockArt, gradient: "bg-gradient-to-br from-[#FEE2E2] to-[#FECACA]", cta: "+ Manage Stock", onClick: () => onNavigate("stock"), stat: stock.length, alert: lowStock },
    { id: "team", title: "Team Members", desc: "Invite your staff and control what each role can see and do.", icon: UsersRound, Art: TeamArt, gradient: "bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A]", cta: "+ Add Member", onClick: () => onNavigate("team"), pro: !teamUnlocked },
  ];

  const roleCards = ROLE_CARD_ACCESS[role] || ROLE_CARD_ACCESS.employee;
  const visibleCards = isAdmin ? cards : cards.filter((c) => roleCards.includes(c.id) && vis[c.id] !== false);

  return (
    <div className="plivex-dashboard-tab space-y-5 sm:space-y-6">
      <PlanStatusCard />
      {canConfirmReminders && (reminderItems.length > 0 || reminderLoading || reminderNotice) && (
        <section className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Payment reminder centre">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><BellRing className="h-4 w-4" /></span>
              <div><h3 className="text-sm font-bold text-slate-900">Payment Reminder Centre</h3><p className="text-[11px] text-slate-500">Review unpaid invoices before sending an email.</p></div>
            </div>
            <Link to="/invoice-history" className="text-xs font-semibold text-[#6D28D9]">View history</Link>
          </div>
          {reminderNotice && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{reminderNotice}</p>}
          {reminderLoading && reminderItems.length === 0 ? <p className="mt-3 text-xs text-slate-500">Checking reminders…</p> : reminderItems.length === 0 ? (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No reminders are waiting for confirmation.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {reminderItems.map((event) => (
                <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="min-w-0"><p className="text-xs font-bold text-slate-900">{event.invoice?.number || "Invoice"} · {event.invoice?.client_name || "Customer"}</p><p className="mt-0.5 text-[11px] text-slate-500">Due reminder · {event.scheduled_for} · {event.recipient_email}</p><p className="mt-0.5 text-xs font-semibold text-slate-700">₹{Number(event.invoice?.total || 0).toLocaleString("en-IN")}</p></div>
                  <button onClick={() => confirmReminder(event)} disabled={!!reminderBusyId} className="inline-flex items-center gap-1.5 rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{reminderBusyId === event.id ? "Sending…" : <><Send className="h-3.5 w-3.5" /> Still unpaid · Send</>}</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="plivex-usage-grid grid grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4" aria-label="Plan usage">
        {quotaCards.map((item) => {
          const hasLimit = Number.isFinite(Number(item.limit)) && item.limit !== null && item.limit !== undefined;
          const limit = hasLimit ? Number(item.limit) : null;
          const percent = limit && limit > 0 ? Math.min(100, item.used / limit * 100) : 0;
          return <div key={item.id} className="rounded-xl border border-[#E5E7EB] bg-white p-3"><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold text-slate-500">{item.label}</span><span className="text-[12px] font-bold text-slate-800">{item.used}{hasLimit ? ` / ${limit}` : " saved"}</span></div>{hasLimit && <><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${percent >= 100 ? "bg-rose-500" : percent >= 80 ? "bg-amber-500" : "bg-[#6D28D9]"}`} style={{ width: `${percent}%` }} /></div><p className="mt-1 text-[10px] text-slate-400">{Math.max(0, limit - item.used)} remaining in current plan</p></>}</div>;
        })}
      </section>
      {pct < 100 && (
      <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-gradient-to-br from-[#6D28D9] to-[#7C3AED] p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Getting started</p>
            <h2 className="mt-1 text-[20px] font-bold">Complete Your Business Profile</h2>
            <p className="mt-1 text-[12px] text-white/80">Add your details once to auto-fill every invoice, quote and report.</p>
          </div>
          <div className="text-right"><p className="text-[28px] font-bold leading-none">{pct}%</p><p className="text-[11px] text-white/70">{done}/{fields.length} steps</p></div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${pct}%` }} /></div>
        <Link to="/business-profile" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-[12px] font-bold text-[#6D28D9] hover:bg-white/90">Finish setup <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
      )}

      {isAdmin && <OwnerMasterControl />}
      {isAdmin && <OwnerTrackingWidgets />}

      <div className="plivex-quick-actions-heading flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-slate-900">Quick actions</h2>
        {isAdmin && <button onClick={() => setVisOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"><Settings2 className="h-3.5 w-3.5" />Manage card visibility</button>}
      </div>

      <div className="plivex-action-cards grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {visibleCards.map((c) => (
          <div key={c.id} className="flex flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm transition-transform hover:-translate-y-0.5">
            <div className={`relative flex h-28 items-center justify-center ${c.gradient}`}>
              <c.Art />
              {c.stat !== undefined && <span className="absolute right-3 top-3 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-sm">{c.stat} saved</span>}
              {c.alert > 0 && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-rose-500 px-2.5 py-1 text-[10px] font-bold uppercase text-white shadow-sm"><AlertTriangle className="h-3 w-3" />Low Stock Alert</span>}
            </div>
            <div className="flex flex-1 flex-col p-5">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#6D28D9]/10 text-[#6D28D9]"><c.icon className="h-4 w-4" /></span>
                <h3 className="text-[15px] font-bold text-slate-900">{c.title}</h3>
                {c.pro && <span className="ml-auto rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-bold text-amber-900">PRO</span>}
              </div>
              <p className="mt-2 flex-1 text-[12px] leading-relaxed text-slate-500">{c.desc}</p>
              <button onClick={c.onClick} className="mt-4 inline-flex items-center gap-1.5 self-start rounded-xl bg-[#6D28D9] px-3.5 py-2 text-[12px] font-bold text-white transition-colors hover:bg-[#7C3AED]">{c.cta}</button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-[#6D28D9]" /><h3 className="text-[14px] font-bold text-slate-900">Help & Support</h3></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <a href="tel:+919758455218" className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] p-3 hover:bg-slate-50"><Phone className="h-4 w-4 text-emerald-600" /><div><p className="text-[12px] font-semibold text-slate-700">+91 97584 55218</p><p className="text-[11px] text-slate-400">Phone support</p></div></a>
          <a href="mailto:support@plivex.in" className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] p-3 hover:bg-slate-50"><Mail className="h-4 w-4 text-[#6D28D9]" /><div><p className="text-[12px] font-semibold text-slate-700">support@plivex.in</p><p className="text-[11px] text-slate-400">Email support</p></div></a>
          <Link to="/help-center" className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] p-3 hover:bg-slate-50"><HelpCircle className="h-4 w-4 text-amber-500" /><div><p className="text-[12px] font-semibold text-slate-700">FAQs & Guides</p><p className="text-[11px] text-slate-400">Browse the help center</p></div></Link>
        </div>
      </div>

      {visOpen && <VisibilityModal cards={cards} vis={vis} setVis={setVis} onClose={() => setVisOpen(false)} />}
    </div>
  );
}

function VisibilityModal({ cards, vis, setVis, onClose }) {
  const toggle = (id) => setVis((v) => ({ ...v, [id]: v[id] === false ? true : false }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><div><h3 className="text-[16px] font-bold text-slate-900">Manage card visibility</h3><p className="text-[11px] text-slate-400">Control which cards team members see on their dashboard.</p></div><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 space-y-2">
          {cards.map((c) => (
            <label key={c.id} className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-2.5 hover:bg-slate-50">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#6D28D9]/10 text-[#6D28D9]"><c.icon className="h-4 w-4" /></span>
              <span className="flex-1 text-[12px] font-semibold text-slate-700">{c.title}</span>
              <button type="button" onClick={() => toggle(c.id)} className={`relative h-6 w-11 rounded-full transition-colors ${vis[c.id] !== false ? "bg-[#6D28D9]" : "bg-slate-200"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${vis[c.id] !== false ? "left-[22px]" : "left-0.5"}`} /></button>
            </label>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400"><Check className="h-3.5 w-3.5 text-emerald-500" />As the boss, you always see every card.</p>
        <div className="mt-4 flex justify-end"><button onClick={onClose} className="rounded-lg bg-[#6D28D9] px-4 py-2 text-[12px] font-bold text-white hover:bg-[#7C3AED]">Done</button></div>
      </div>
    </div>
  );
}