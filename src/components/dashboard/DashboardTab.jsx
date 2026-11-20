import { formatMoney } from "@/lib/currency";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, FilePlus2, ShoppingCart, Users, UserPlus, BarChart3, ArrowRight, Phone, Mail, HelpCircle, Package, UsersRound, AlertTriangle, Settings2, X, Check, BellRing, ChevronUp, ChevronDown, Send, Warehouse } from "lucide-react";
import { KEYS, useLocalState, loadList } from "@/lib/stores";
import OwnerMasterControl from "@/components/dashboard/OwnerMasterControl";
import OwnerTrackingWidgets from "@/components/dashboard/OwnerTrackingWidgets";
import PlanStatusCard from "@/components/PlanStatusCard";
import { usePaywall } from "@/lib/paywall";
import { supabase } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";
import { getPermanentDashboardFeatures, useWorkspaceFeatures } from "@/lib/workspaceFeatures";
import FeatureLibraryModal from "@/components/dashboard/FeatureLibraryModal";

const CARD_KEY = "invoicepulse:cardVisibility";
const CARD_ORDER_KEY = "invoicepulse:dashboardCardOrder";
const DEFAULT_CARD_ORDER = ["invoices", "quotations", "expenses", "crm", "leads", "reports", "stock", "team", "inventoryWorkspace"];
const DEFAULT_VIS = { invoices: true, quotations: true, expenses: true, crm: true, leads: true, stock: true, team: true, inventoryWorkspace: true };

// Strict per-role dashboard card visibility. A role can never see cards outside its allowlist.
const ROLE_CARD_ACCESS = {
  admin: ["invoices", "quotations", "expenses", "crm", "leads", "reports", "stock", "team", "inventoryWorkspace"],
  manager: ["invoices", "quotations", "expenses", "crm", "leads", "reports", "stock", "team", "inventoryWorkspace"],
  employee: ["invoices", "quotations", "crm", "leads"],
  accountant: ["invoices", "quotations", "expenses", "reports"],
  storekeeper: ["stock", "inventoryWorkspace"],
};

export default function DashboardTab({ onNavigate, onCreateInvoice, role, teamUnlocked }) {
  const isAdmin = role === "admin";
  const { user } = useAuth();
  const { features, updateFeatures, saving: savingFeatures, error: featureError } = useWorkspaceFeatures(user?.workspace_id);
  const [featureOpen, setFeatureOpen] = useState(false);
  const { limits, usage } = usePaywall();
  const [profile] = useLocalState(KEYS.businessProfile, { name: "", address: "", gstin: "", email: "", phone: "", logo: "" });
  const [vis, setVis] = useLocalState(CARD_KEY, DEFAULT_VIS);
  const [cardOrder, setCardOrder] = useLocalState(CARD_ORDER_KEY, DEFAULT_CARD_ORDER);
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
    { id: "invoices", title: "Invoices", desc: "Bill clients with GST-ready, print-perfect PDFs in under a minute.", icon: FileText, gradient: "bg-gradient-to-br from-[#EDE9FE] to-[#DDD6FE]", cta: "+ Create New Invoice", onClick: onCreateInvoice, stat: loadList(KEYS.history).length },
    { id: "quotations", title: "Quotations", desc: "Send estimates clients can approve, then convert to invoices in one click.", icon: FilePlus2, gradient: "bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE]", cta: "+ Create New Quotation", onClick: () => onNavigate("sales", "new-quotation"), stat: loadList(KEYS.quotations).length },
    { id: "expenses", title: "Expenses", desc: "Track vendor bills and purchases to see your real net profit.", icon: ShoppingCart, gradient: "bg-gradient-to-br from-[#DCFCE7] to-[#BBF7D0]", cta: "+ Record New Purchase", onClick: () => onNavigate("purchase", "new-expense") },
    { id: "crm", title: "Client CRM", desc: "Save client details once and reuse them forever across invoices.", icon: Users, gradient: "bg-gradient-to-br from-[#FAE8FF] to-[#F5D0FE]", cta: "+ Add New Client", onClick: () => onNavigate("crm", "new-client"), stat: loadList(KEYS.clients).length },
    { id: "leads", title: "Lead Tracker", desc: "Move leads from new to won and never miss a follow-up.", icon: UserPlus, gradient: "bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A]", cta: "+ Add New Lead", onClick: () => onNavigate("crm", "new-lead"), stat: loadList(KEYS.leads).length },
    { id: "reports", title: "Reports", desc: "Understand sales, purchases and business performance with clear reports.", icon: BarChart3, gradient: "bg-gradient-to-br from-[#E0F2FE] to-[#BAE6FD]", cta: "View business reports", onClick: () => onNavigate("reports") },
    { id: "stock", title: "Stock Inventory", desc: "Manage products and watch quantities auto-deduct on every invoice.", icon: Package, gradient: "bg-gradient-to-br from-[#FEE2E2] to-[#FECACA]", cta: "+ Manage Stock", onClick: () => onNavigate("stock"), stat: stock.length, alert: lowStock },
    { id: "team", title: "Team Members", desc: "Invite your staff and control what each role can see and do.", icon: UsersRound, gradient: "bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A]", cta: "+ Add Member", onClick: () => onNavigate("team"), pro: !teamUnlocked },
    { id: "inventoryWorkspace", title: "Inventory & Warehouse", desc: "Manage stock locations, transfers, purchase orders, goods receipts and movement history in one connected workspace.", icon: Warehouse, gradient: "bg-gradient-to-br from-[#E0E7FF] to-[#C7D2FE]", cta: "Open inventory workspace", onClick: () => onNavigate("warehouses") },
  ];

  const roleCards = ROLE_CARD_ACCESS[role] || ROLE_CARD_ACCESS.employee;
  const permanentCards = getPermanentDashboardFeatures(user?.workspace_type);
  const normalizedOrder = [...new Set([...(Array.isArray(cardOrder) ? cardOrder : []), ...DEFAULT_CARD_ORDER])];
  const orderedCards = [...cards].sort((a, b) => normalizedOrder.indexOf(a.id) - normalizedOrder.indexOf(b.id));
  const moveCard = (id, direction) => setCardOrder((current) => {
    const order = [...new Set([...(Array.isArray(current) ? current : []), ...DEFAULT_CARD_ORDER])];
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return order;
    [order[index], order[target]] = [order[target], order[index]];
    return order;
  });
  const visibleCards = orderedCards.filter((card) => roleCards.includes(card.id) && (permanentCards.includes(card.id) || (features.includes(card.id) && (isAdmin || vis[card.id] !== false))));

  return (
    <div className="plivex-dashboard-tab space-y-5 sm:space-y-6">
      <PlanStatusCard />
      {canConfirmReminders && (reminderItems.length > 0 || reminderLoading || reminderNotice) && (
        <section className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Payment reminder centre">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
                  <div className="min-w-0"><p className="text-xs font-bold text-slate-900">{event.invoice?.number || "Invoice"} · {event.invoice?.client_name || "Customer"}</p><p className="mt-0.5 text-[11px] text-slate-500">Due reminder · {event.scheduled_for} · {event.recipient_email}</p><p className="mt-0.5 text-xs font-semibold text-slate-700">{formatMoney(Number(event.invoice?.total || 0), event.invoice?.currency || user?.currency_code || "INR", user?.locale_code)}</p></div>
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
          return <div key={item.id} className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-shadow hover:shadow-sm"><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold text-slate-600">{item.label}</span><span className="text-[12px] font-bold tabular-nums text-slate-800">{item.used}{hasLimit ? ` / ${limit}` : " saved"}</span></div>{hasLimit && <><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`${item.label} usage`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(item.used, limit)}><div className={`h-full rounded-full transition-[width] duration-300 ${percent >= 100 ? "bg-rose-500" : percent >= 80 ? "bg-amber-500" : "bg-[#6D28D9]"}`} style={{ width: `${percent}%` }} /></div><p className={`mt-1.5 text-[10px] font-medium ${item.used >= limit ? "text-amber-700" : "text-slate-500"}`}>{item.used > limit ? `Limit exceeded by ${item.used - limit}` : item.used === limit ? "Plan limit reached" : `${limit - item.used} remaining this cycle`}</p></>}</div>;
        })}
      </section>
      {pct < 100 && (
      <div className="plivex-hover-lift overflow-hidden rounded-2xl border border-violet-300/20 bg-gradient-to-br from-[#6D28D9] to-[#7C3AED] p-5 text-white shadow-[0_12px_32px_rgba(109,40,217,.16)] sm:p-6">
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
        {isAdmin && <button onClick={() => setVisOpen(true)} className="flex min-h-10 max-w-full items-center gap-1.5 whitespace-normal rounded-lg border border-[#E5E7EB] px-3 py-2 text-left text-[11px] font-semibold leading-4 text-slate-600 hover:bg-slate-50"><Settings2 className="h-3.5 w-3.5" />Manage card visibility</button>}
      </div>

      <div className="plivex-action-cards grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {visibleCards.map((c) => (
          <div key={c.id} className="plivex-hover-lift group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E8E7EF] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all duration-200">
            <div className={`relative flex h-24 items-center justify-center sm:h-28 ${c.gradient} transition-colors`}>
              <c.icon className="h-10 w-10 text-[#6D28D9] sm:h-11 sm:w-11" strokeWidth={1.5} aria-hidden="true" />
              {c.stat !== undefined && <span className="absolute right-3 top-3 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-sm">{c.stat} saved</span>}
              {c.alert > 0 && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-rose-500 px-2.5 py-1 text-[10px] font-bold uppercase text-white shadow-sm"><AlertTriangle className="h-3 w-3" />Low Stock Alert</span>}
            </div>
            <div className="flex flex-1 flex-col p-4 sm:p-[18px]">
              <div className="flex items-center gap-2">
                <h3 className="break-words text-[14px] font-bold tracking-[-0.02em] text-slate-900 sm:text-[15px]">{c.title}</h3>
                {c.pro && <span className="ml-auto rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-bold text-amber-900">PRO</span>}
              </div>
              <p className="mt-2 flex-1 text-[11px] leading-[1.7] text-slate-600 sm:text-[12px]">{c.desc}</p>
              <button onClick={c.onClick} className="mt-4 inline-flex min-h-10 max-w-full items-center gap-1.5 self-start rounded-xl bg-[#6D28D9] px-3.5 py-2 text-[11px] font-bold text-white shadow-sm transition-all hover:bg-[#5B21B6] hover:shadow">{c.cta}</button>
            </div>
          </div>
        ))}
        {isAdmin && <button type="button" onClick={() => setFeatureOpen(true)} className="group flex min-h-[270px] flex-col items-start justify-between overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-white via-white to-violet-50/80 p-5 text-left shadow-[0_1px_3px_rgba(76,29,149,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md sm:p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-violet-700 transition-colors group-hover:bg-violet-100"><Settings2 className="h-5 w-5" /></span>
          <span className="mt-5 block"><span className="block text-[15px] font-bold tracking-tight text-slate-900">More Features</span><span className="mt-1.5 block max-w-[250px] text-[12px] leading-[1.65] text-slate-600">Shape your workspace with the tools that match the way your business works.</span></span>
          <span className="mt-5 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#6D28D9] px-3.5 py-2 text-[11px] font-bold text-white shadow-sm transition-colors group-hover:bg-[#5B21B6]">Explore features <ArrowRight className="h-3.5 w-3.5" /></span>
        </button>}
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-[#6D28D9]" /><h3 className="text-[14px] font-bold text-slate-900">Help & Support</h3></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <a href="tel:+919758455218" className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] p-3 hover:bg-slate-50"><Phone className="h-4 w-4 text-emerald-600" /><div><p className="text-[12px] font-semibold text-slate-700">+91 97584 55218</p><p className="text-[11px] text-slate-400">Phone support</p></div></a>
          <a href="mailto:support@plivex.in" className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] p-3 hover:bg-slate-50"><Mail className="h-4 w-4 text-[#6D28D9]" /><div><p className="text-[12px] font-semibold text-slate-700">support@plivex.in</p><p className="text-[11px] text-slate-400">Email support</p></div></a>
          <Link to="/help-center" className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] p-3 hover:bg-slate-50"><HelpCircle className="h-4 w-4 text-amber-500" /><div><p className="text-[12px] font-semibold text-slate-700">FAQs & Guides</p><p className="text-[11px] text-slate-400">Browse the help center</p></div></Link>
        </div>
      </div>

      {visOpen && <VisibilityModal cards={orderedCards} vis={vis} setVis={setVis} onMove={moveCard} onClose={() => setVisOpen(false)} />}
      {featureOpen && <FeatureLibraryModal features={features} permanentFeatures={permanentCards} updateFeatures={updateFeatures} saving={savingFeatures} error={featureError} onClose={() => setFeatureOpen(false)} />}
    </div>
  );
}

function VisibilityModal({ cards, vis, setVis, onMove, onClose }) {
  const toggle = (id) => setVis((v) => ({ ...v, [id]: v[id] === false ? true : false }));
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/40 p-2 backdrop-blur-sm sm:grid sm:place-items-center sm:p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="manage-card-visibility-title" className="mx-auto my-2 max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-white p-3 shadow-xl sm:my-0 sm:max-h-[min(88dvh,760px)] sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 id="manage-card-visibility-title" className="break-words text-[15px] font-bold leading-5 text-slate-900 sm:text-base">Manage card visibility</h3><p className="mt-1 text-[11px] leading-4 text-slate-500">Choose which cards appear and change their order.</p></div>
          <button type="button" onClick={onClose} aria-label="Close card visibility settings" className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 space-y-2">
          {cards.map((c, index) => (
            <div key={c.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-[#E5E7EB] p-2 hover:bg-slate-50">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#6D28D9]/10 text-[#6D28D9]"><c.icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1 break-words text-[12px] font-semibold leading-4 text-slate-700">{c.title}</span>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => onMove(c.id, -1)} disabled={index === 0} aria-label={`Move ${c.title} up`} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 disabled:cursor-not-allowed disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => onMove(c.id, 1)} disabled={index === cards.length - 1} aria-label={`Move ${c.title} down`} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 disabled:cursor-not-allowed disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => toggle(c.id)} aria-label={`${vis[c.id] !== false ? "Hide" : "Show"} ${c.title}`} aria-pressed={vis[c.id] !== false} className={`relative ml-1 h-6 w-11 rounded-full transition-colors ${vis[c.id] !== false ? "bg-[#6D28D9]" : "bg-slate-200"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${vis[c.id] !== false ? "left-[22px]" : "left-0.5"}`} /></button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] leading-4 text-slate-500"><Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />As the workspace owner, you always see every card.</p>
        <div className="mt-4 flex justify-end"><button onClick={onClose} className="min-h-10 rounded-lg bg-[#6D28D9] px-5 py-2 text-[12px] font-bold text-white hover:bg-[#7C3AED]">Done</button></div>
      </section>
    </div>
  );
}