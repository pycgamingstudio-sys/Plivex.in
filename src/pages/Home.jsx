import { backend as db } from '@/api/backendClient';

import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

import { Link } from "react-router-dom";
import { KEYS, pushItem, genId, loadList, loadState, removeState, tenantKey, saveInvoiceToServer } from "@/lib/stores";
import { useAuth } from "@/lib/AuthContext";
import { startPayuCheckout } from "@/lib/payu";
import { usePaywall } from "@/lib/paywall";
import { trackStaffAction } from "@/lib/staffTracking";
import PresenceBeacon from "@/components/PresenceBeacon";
import Logo from "@/components/Logo";
import HSNAutocomplete from "@/components/HSNAutocomplete";
import CurrentPlanCard from "@/components/CurrentPlanCard";
import DesignPicker from "@/components/invoice/DesignPicker";
import { DEFAULT_DESIGN_ID, InvoiceDesign, isPremiumDesign } from "@/components/invoice/designs";
import {
  AlertCircle,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Download,
  FilePenLine,
  FilePlus2,
  FileText,
  ImagePlus,
  Info,
  History,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Scissors,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  WalletCards,
  X,
  Zap,
} from "lucide-react";

const initialInvoice = {
  business: { name: "", email: "", phone: "", gstin: "", address: "" },
  client: { name: "", company: "", email: "", phone: "", gstin: "", address: "" },
  number: "", issueDate: "", dueDate: "", currency: "INR",
  items: [
    { id: "item-1", description: "", quantity: "", rate: "", gstRate: 18 },
  ],
  taxRate: 18, taxMode: "split", discountType: "percent", discount: "",
  notes: "", terms: "", upiId: "", design: "classic",
};

const inputClass = "mt-1.5 w-full rounded-lg border bg-card px-3 py-2.5 text-[13px] text-foreground transition-colors placeholder:text-muted-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/10";
const smallInputClass = "w-full rounded-md border bg-card px-2.5 py-2 text-[13px] text-foreground focus:border-primary focus:ring-2 focus:ring-primary/10";
const descInputClass = "w-full min-w-0 rounded-lg border bg-card px-3.5 py-3 text-[14px] text-foreground transition-colors placeholder:text-muted-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/10";
const itemDescInputClass = "w-full min-w-[260px] rounded-lg border bg-card px-3.5 text-[14px] text-black transition-colors placeholder:text-muted-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/10";
const invalidInputClass = "border-destructive focus:border-destructive focus:ring-destructive/10";
const withErrorClass = (baseClass, error) => `${baseClass} ${error ? invalidInputClass : ""}`;

function useStored(key, fallback, resetMarker) {
  const scopedKey = tenantKey(key);
  const [value, setValue] = useState(() => {
    try {
      if (resetMarker && localStorage.getItem(tenantKey(resetMarker)) !== "1") {
        localStorage.removeItem(scopedKey);
        localStorage.setItem(tenantKey(resetMarker), "1");
        return fallback;
      }
      const stored = localStorage.getItem(scopedKey);
      return stored ? JSON.parse(stored) : fallback;
    } catch { return fallback; }
  });
  useEffect(() => { try { localStorage.setItem(scopedKey, JSON.stringify(value)); } catch { /* local persistence is best effort */ } }, [scopedKey, value]);
  return [value, setValue];
}

function Field({ label, children, hint, error }) {
  return (
    <label className="block text-[12px] font-semibold text-muted-foreground">
      <span className="flex items-center justify-between">{label}{hint && <span className="font-normal opacity-70">{hint}</span>}</span>
      {children}
      {error && <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-destructive"><AlertCircle className="h-3 w-3" />{error}</span>}
    </label>
  );
}

function SectionCard({ icon: Icon, title, eyebrow, children, action }) {
  return (
    <section className="rounded-xl border bg-card p-4 transition-colors sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"><Icon className="h-4 w-4" /></div>
          <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/70">{eyebrow || "Invoice details"}</p><h2 className="mt-0.5 text-[15px] font-bold tracking-[-0.02em]">{title}</h2></div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Sidebar({ onNew, onPricing }) {
  const { user } = useAuth();
  return (
    <aside className="app-chrome hidden w-[228px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex items-center gap-2.5 px-5 py-6">
        <Logo className="h-8 w-8" />
        <div><p className="text-[15px] font-bold tracking-[-0.04em]">Plivex</p><p className="text-[10px] text-sidebar-foreground/55">Billing, without the drag.</p></div>
      </div>
      <div className="px-3">
        <button data-testid="button-new-invoice-sidebar" onClick={onNew} className="flex w-full items-center justify-center gap-2 rounded-lg bg-sidebar-primary px-3 py-2.5 text-[12px] font-bold text-sidebar-primary-foreground transition-transform hover:-translate-y-0.5"><FilePlus2 className="h-4 w-4" />New invoice</button>
      </div>
      <nav className="mt-8 space-y-1 px-3" aria-label="Primary">
        <Link to="/" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><LayoutDashboard className="h-4 w-4" />← Dashboard</Link>
        <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-2.5 text-[12px] font-semibold text-sidebar-accent-foreground"><FilePenLine className="h-4 w-4 text-sidebar-primary" />Invoice desk<span className="ml-auto rounded bg-sidebar-primary/15 px-1.5 py-0.5 font-mono-ui text-[10px] text-sidebar-primary">draft</span></div>
        <button data-testid="button-invoices-sidebar" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><Layers3 className="h-4 w-4" />All invoices<span className="ml-auto font-mono-ui text-[10px]">01</span></button>
        <Link to="/invoice-history" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><History className="h-4 w-4" />Invoice history</Link>
        <button data-testid="button-settings-sidebar" onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><Settings2 className="h-4 w-4" />Workspace settings</button>
      </nav>
      <div className="mt-auto p-3">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3.5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold"><Sparkles className="h-3.5 w-3.5 text-sidebar-primary" />Free workspace</div>
          <p className="text-[11px] leading-relaxed text-sidebar-foreground/55">Three polished PDF exports, then keep going for ₹249/month.</p>
          <button data-testid="button-upgrade-sidebar" onClick={onPricing} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-sidebar-primary px-3 py-2.5 text-[11px] font-bold text-sidebar-primary-foreground transition-transform hover:-translate-y-0.5"><Sparkles className="h-3.5 w-3.5" />Pricing Plans</button>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-sidebar-border pt-4">{user?.profilePicture ? <img src={user.profilePicture} alt="avatar" className="h-7 w-7 rounded-full object-cover" /> : <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sidebar-primary/15 text-[10px] font-bold text-sidebar-primary">{(user?.full_name || user?.email || "U").charAt(0).toUpperCase()}</div>}<div className="min-w-0"><p className="truncate text-[11px] font-semibold">{user?.full_name || "Account"}</p><p className="truncate text-[10px] text-sidebar-foreground/45">{user?.email || ""}</p></div><MoreHorizontal className="ml-auto h-4 w-4 text-sidebar-foreground/45" /></div>
      </div>
    </aside>
  );
}

function Topbar({ isDark, isPremium, onToggleTheme, onDownload, onWhatsApp, onPricing, onMenu, canDownload = true, canShare = true, planName = "Free", whatsappSending = false }) {
  return (
    <header className="app-chrome sticky top-0 z-20 flex h-[70px] items-center justify-between border-b bg-background/90 px-4 backdrop-blur-xl sm:px-7">
      <div className="flex items-center gap-3"><button data-testid="button-mobile-menu" onClick={onMenu} className="rounded-md p-2 hover:bg-secondary md:hidden"><Menu className="h-5 w-5" /></button><div className="flex items-center gap-2 md:hidden"><Logo className="h-7 w-7" /><p className="text-[15px] font-bold tracking-[-0.04em]">Pli<span className="text-primary">vex</span></p></div><div className="hidden md:block"><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span>Workspace</span><span>/</span><span className="font-medium text-foreground">Invoice desk</span></div><h1 className="mt-0.5 text-[16px] font-bold tracking-[-0.03em]">New invoice <span className="ml-1 rounded-md bg-accent/20 px-1.5 py-0.5 font-mono-ui text-[9px] font-medium text-accent-foreground">DRAFT</span></h1></div></div>
      <div className="flex items-center gap-2 sm:gap-3"><div className="hidden items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[11px] text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Saved locally <span className="font-mono-ui text-[10px] text-foreground/70">just now</span></div><div data-testid="usage-badge" className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1.5 text-[11px] font-semibold"><Zap className="h-3.5 w-3.5 text-accent-foreground" /><span className="font-mono-ui">{isPremium ? "∞" : "Free"}</span><span className="hidden sm:inline text-muted-foreground">{isPremium ? planName : "Free plan"}</span></div><button data-testid="button-toggle-theme" onClick={onToggleTheme} className="flex h-9 w-9 items-center justify-center rounded-lg border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary" aria-label="Toggle dark mode">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button><button data-testid="button-pricing-topbar-mobile" onClick={onPricing} className="flex h-9 w-9 items-center justify-center rounded-lg border bg-card text-primary transition-colors hover:border-primary/45 sm:hidden" aria-label="Pricing plans"><Sparkles className="h-4 w-4" /></button>
<button data-testid="button-pricing-topbar" onClick={onPricing} className="hidden rounded-lg border px-3 py-2 text-[12px] font-semibold text-foreground transition-colors hover:border-primary/45 hover:text-primary sm:block">{isPremium ? "Pro plan" : "Pricing"}</button><button data-testid="button-whatsapp-topbar" onClick={onWhatsApp} disabled={whatsappSending} className={`flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[12px] font-bold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-70 ${canShare ? "bg-[#25D366]" : "bg-muted"}`}><MessageCircle className="h-3.5 w-3.5" /><span className="hidden sm:inline">{whatsappSending ? "Preparing…" : "Send via WhatsApp"}</span>{!canShare && !whatsappSending && <LockKeyhole className="h-3.5 w-3.5" />}</button><button data-testid="button-download-topbar" onClick={onDownload} className={`flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[12px] font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 ${canDownload ? "bg-primary" : "bg-muted"}`}><Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Download PDF</span>{!canDownload && <LockKeyhole className="h-3.5 w-3.5" />}</button></div>
    </header>
  );
}

function MobileMenu({ open, onClose, onNew, onPricing }) {
  if (!open) return null;
  return (
    <div className="app-chrome fixed inset-0 z-40 bg-sidebar/30 backdrop-blur-sm md:hidden" onClick={onClose}><div className="flex h-full w-[275px] flex-col bg-sidebar p-4 text-sidebar-foreground" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between px-2 py-3"><div className="flex items-center gap-2"><Logo className="h-8 w-8" rounded="rounded-lg" /><span className="font-bold">Plivex</span></div><button data-testid="button-close-mobile-menu" onClick={onClose} className="rounded-md p-2 hover:bg-sidebar-accent"><X className="h-4 w-4" /></button></div><button data-testid="button-new-invoice-mobile" onClick={onNew} className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-sidebar-primary py-3 text-xs font-bold text-sidebar-primary-foreground"><FilePlus2 className="h-4 w-4" />New invoice</button><Link to="/" className="mt-6 flex items-center gap-3 rounded-lg px-3 py-3 text-xs font-semibold text-sidebar-foreground/70 hover:bg-sidebar-accent"><LayoutDashboard className="h-4 w-4" />← Dashboard</Link>
<div className="mt-8 flex items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-3 text-xs font-semibold"><FilePenLine className="h-4 w-4 text-sidebar-primary" />Invoice desk</div><Link to="/invoice-history" className="mt-1 flex items-center gap-3 rounded-lg px-3 py-3 text-left text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent"><History className="h-4 w-4" />Workspace manager</Link>
<button data-testid="button-mobile-pricing" onClick={onPricing} className="mt-1 flex items-center gap-3 rounded-lg px-3 py-3 text-left text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent"><Sparkles className="h-4 w-4" />Pricing & exports</button></div></div>
  );
}

function InvoiceEditor({ invoice, setInvoice, errors, onClearError, onToast, onSignature, canAccess = () => true, onLocked = () => {}, design }) {
  const stockItems = loadList(KEYS.stock);
  const setBusiness = (key, value) => { setInvoice((old) => ({ ...old, business: { ...old.business, [key]: value } })); if (key === "name") onClearError("businessName"); };
  const setClient = (key, value) => { setInvoice((old) => ({ ...old, client: { ...old.client, [key]: value } })); if (key === "name") onClearError("clientName"); };
  const updateItem = (id, key, value) => {
    setInvoice((old) => ({ ...old, items: old.items.map((item) => item.id === id ? { ...item, [key]: key === "quantity" || key === "rate" ? (value === "" ? "" : Number(value)) : value } : item) }));
    if (key === "description") onClearError(`item.${id}.description`);
    if (key === "rate") onClearError(`item.${id}.rate`);
  };
  const addItem = () => { const id = `item-${Date.now()}`; setInvoice((old) => ({ ...old, items: [...old.items, { id, description: "", quantity: "", rate: "", gstRate: old.taxRate }] })); onToast("Line item added"); };
  const duplicateItem = (item) => { const id = `item-${Date.now()}`; setInvoice((old) => ({ ...old, items: [...old.items, { ...item, id, description: `${item.description} (copy)` }] })); onToast("Line item duplicated"); };
  const deleteItem = (id) => { if (invoice.items.length === 1) { onToast("Keep at least one line item", "info"); return; } setInvoice((old) => ({ ...old, items: old.items.filter((item) => item.id !== id) })); onToast("Line item removed", "info"); };
  const uploadImage = (event, key) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { setInvoice((old) => ({ ...old, [key]: String(reader.result) })); onToast(`${key === "logo" ? "Logo" : "Signature"} added`); }; reader.readAsDataURL(file); };
  return (
    <div className="space-y-4">
      <SectionCard icon={Sparkles} eyebrow="Look & feel" title="Invoice design" action={<span className="font-mono-ui text-[10px] text-muted-foreground">2 free · 3 pro</span>}>
        <DesignPicker value={design} onChange={(id) => setInvoice((old) => ({ ...old, design: id }))} canPremium={canAccess("premium_designs")} onLocked={onLocked} />
      </SectionCard>
      <SectionCard icon={BriefcaseBusiness} eyebrow="From" title="Your business" action={<span className="flex items-center gap-1 text-[10px] text-emerald-600"><BadgeCheck className="h-3 w-3" />Ready to send</span>}>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Your Business Name" error={errors.businessName}><input required data-testid="input-business-name" className={withErrorClass(inputClass, errors.businessName)} value={invoice.business.name} onChange={(e) => setBusiness("name", e.target.value)} placeholder="Your Business Name (required)" /></Field><Field label="GSTIN" hint="Optional"><input data-testid="input-gstin" className={inputClass} value={invoice.business.gstin} onChange={(e) => setBusiness("gstin", e.target.value)} placeholder="22AAAAA0000A1Z5" /></Field><Field label="Email"><input data-testid="input-business-email" type="email" className={inputClass} value={invoice.business.email} onChange={(e) => setBusiness("email", e.target.value)} placeholder="you@studio.in" /></Field><Field label="Phone"><input data-testid="input-business-phone" className={inputClass} value={invoice.business.phone} onChange={(e) => setBusiness("phone", e.target.value)} placeholder="+91" /></Field></div>
        <Field label="Business address"><textarea data-testid="input-business-address" className={`${inputClass} min-h-[68px]`} value={invoice.business.address} onChange={(e) => setBusiness("address", e.target.value)} placeholder="Enter address (optional)" /></Field>
        <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t pt-4">{canAccess("custom_logo") ? (<label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"><ImagePlus className="h-3.5 w-3.5" />{invoice.logo ? "Replace logo" : "Add logo"}<input data-testid="input-logo-upload" type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => uploadImage(e, "logo")} /></label>) : (<button type="button" onClick={onLocked} className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"><LockKeyhole className="h-3.5 w-3.5" />{invoice.logo ? "Replace logo" : "Add logo"}<span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono-ui text-[9px] font-bold uppercase text-primary">Pro</span></button>)}<button data-testid="button-draw-signature" onClick={onSignature} className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"><Pencil className="h-3.5 w-3.5" />{invoice.signature ? "Edit signature" : "Draw signature"}</button><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"><ImagePlus className="h-3.5 w-3.5" />Upload signature<input data-testid="input-signature-upload" type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => uploadImage(e, "signature")} /></label><span className="text-[10px] text-muted-foreground">Optional · shown on the final page</span></div>
      </SectionCard>
      <SectionCard icon={WalletCards} eyebrow="Bill to" title="Client details">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Client Business Name" error={errors.clientName}><input required data-testid="input-client-name" className={withErrorClass(inputClass, errors.clientName)} value={invoice.client.name} onChange={(e) => setClient("name", e.target.value)} placeholder="Client Business Name (required)" /></Field><Field label="Company" hint="Optional"><input data-testid="input-client-company" className={inputClass} value={invoice.client.company} onChange={(e) => setClient("company", e.target.value)} placeholder="Company name (optional)" /></Field><Field label="Email"><input data-testid="input-client-email" type="email" className={inputClass} value={invoice.client.email} onChange={(e) => setClient("email", e.target.value)} placeholder="accounts@client.com" /></Field><Field label="Phone"><input data-testid="input-client-phone" className={inputClass} value={invoice.client.phone} onChange={(e) => setClient("phone", e.target.value)} placeholder="+91" /></Field><Field label="GSTIN" hint="Optional"><input data-testid="input-client-gstin" className={inputClass} value={invoice.client.gstin} onChange={(e) => setClient("gstin", e.target.value)} placeholder="22AAAAA0000A1Z5" /></Field></div><Field label="Client address"><textarea data-testid="input-client-address" className={`${inputClass} min-h-[68px]`} value={invoice.client.address} onChange={(e) => setClient("address", e.target.value)} placeholder="Enter address (optional)" /></Field>
      </SectionCard>
      <SectionCard icon={CalendarDays} eyebrow="Control the details" title="Invoice settings">
        <div className="grid gap-3 sm:grid-cols-4"><Field label="Invoice no."><input data-testid="input-invoice-number" className={inputClass} value={invoice.number} onChange={(e) => setInvoice((old) => ({ ...old, number: e.target.value }))} placeholder="INV-0001 (optional)" /></Field><Field label="Currency"><select data-testid="select-currency" className={`${inputClass} ${!canAccess("multi_currency") ? "opacity-60" : ""}`} disabled={!canAccess("multi_currency")} value={invoice.currency} onChange={(e) => setInvoice((old) => ({ ...old, currency: e.target.value }))}><option value="INR">INR · ₹</option><option value="USD">USD · $</option><option value="EUR">EUR · €</option></select>{!canAccess("multi_currency") && <button type="button" onClick={onLocked} className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"><LockKeyhole className="h-3 w-3" />Unlock Multi-Currency</button>}</Field><Field label="Issue date" error={errors.issueDate}><input data-testid="input-issue-date" type="date" className={withErrorClass(inputClass, errors.issueDate)} value={invoice.issueDate} onChange={(e) => { setInvoice((old) => ({ ...old, issueDate: e.target.value })); if (e.target.value) onClearError("issueDate"); }} /></Field><Field label="Due date"><input data-testid="input-due-date" type="date" className={inputClass} value={invoice.dueDate} onChange={(e) => setInvoice((old) => ({ ...old, dueDate: e.target.value }))} /></Field></div>
        <div className="mt-3"><Field label="Your UPI ID / VPA" hint="Optional · adds a pay QR"><input data-testid="input-upi-id" className={inputClass} value={invoice.upiId || ""} onChange={(e) => setInvoice((old) => ({ ...old, upiId: e.target.value }))} placeholder="9876543210@paytm" /></Field></div>
      </SectionCard>
      <SectionCard icon={FileText} eyebrow="What you did" title="Line items" action={<span className="font-mono-ui text-[10px] text-muted-foreground">{invoice.items.length.toString().padStart(2, "0")} items</span>}>
        <div className="space-y-3">
          {invoice.items.map((item, index) => (
            <div data-testid={`row-line-item-${item.id}`} key={item.id} className="rounded-lg border bg-background/50 p-3 transition-colors hover:border-primary/30 flex flex-col" style={{ gap: "12px", width: "100%" }}>
              <div className="flex items-start gap-2 w-full">
                <span className="pt-3 font-mono-ui text-[10px] text-muted-foreground shrink-0">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1 w-full">
                  <Field label="" error={errors[`item.${item.id}.description`]}>
                    <HSNAutocomplete value={item.description} onChange={(v) => { updateItem(item.id, "description", v); onClearError(`item.${item.id}.description`); }} onSelect={(s) => { updateItem(item.id, "description", s.description); updateItem(item.id, "gstRate", s.gst_rate); onToast(`HSN ${s.hsn_code} · ${s.gst_rate}% applied`); }} placeholder="Item name — type to search HSN" className={withErrorClass(itemDescInputClass, errors[`item.${item.id}.description`])} style={{ flex: "1 1 auto", minHeight: "42px", width: "100%" }} />
                  </Field>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full">
                <span className="w-10 shrink-0 text-[10px] font-semibold text-muted-foreground">Qty</span>
                <input data-testid={`input-item-quantity-${item.id}`} type="number" min="0" className={`${smallInputClass} flex-1`} value={item.quantity} onChange={(e) => updateItem(item.id, "quantity", e.target.value)} placeholder="Qty" aria-label="Quantity" />
              </div>
              <div className="flex items-center gap-2 w-full">
                <span className="w-10 shrink-0 text-[10px] font-semibold text-muted-foreground">Rate</span>
                <div className="flex-1">
                  <Field label="" error={errors[`item.${item.id}.rate`]}><div className="relative w-full"><span className="pointer-events-none absolute left-2.5 top-2 text-[11px] text-muted-foreground">₹</span><input required data-testid={`input-item-rate-${item.id}`} type="number" min="0" className={withErrorClass(`${smallInputClass} pl-6 w-full`, errors[`item.${item.id}.rate`])} value={item.rate} onChange={(e) => updateItem(item.id, "rate", e.target.value)} placeholder="0.00" aria-label="Rate or amount" /></div></Field>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full">
                <span className="w-10 shrink-0 text-[10px] font-semibold text-muted-foreground">GST</span>
                <select data-testid={`select-item-gst-${item.id}`} className={`${smallInputClass} flex-1`} value={item.gstRate ?? invoice.taxRate} onChange={(e) => updateItem(item.id, "gstRate", e.target.value)}><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button data-testid={`button-duplicate-item-${item.id}`} onClick={() => duplicateItem(item)} className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary" aria-label="Duplicate line item"><Copy className="h-3.5 w-3.5" /></button>
                <button data-testid={`button-delete-item-${item.id}`} onClick={() => deleteItem(item.id)} className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" aria-label="Delete line item"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        <button data-testid="button-add-line-item" onClick={addItem} className="mt-4 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[11px] font-bold text-primary transition-colors hover:bg-secondary"><Plus className="h-3.5 w-3.5" />Add line item</button>
        <datalist id="stock-suggestions">{stockItems.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      </SectionCard>
      <SectionCard icon={Scissors} eyebrow="Tune the total" title="Tax & discount">
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Default GST rate"><div className="relative"><select data-testid="input-tax-rate" className={inputClass} value={invoice.taxRate} onChange={(e) => { const rate = Number(e.target.value); setInvoice((old) => ({ ...old, taxRate: rate, items: old.items.map((item) => ({ ...item, gstRate: rate })) })); }}><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select></div></Field><Field label="Discount"><div className="flex gap-2"><input data-testid="input-discount" type="number" min="0" className={`${inputClass} mt-1.5`} value={invoice.discount} onChange={(e) => setInvoice((old) => ({ ...old, discount: Number(e.target.value) }))} /><select data-testid="select-discount-type" className={`${inputClass} mt-1.5 w-[92px]`} value={invoice.discountType} onChange={(e) => setInvoice((old) => ({ ...old, discountType: e.target.value }))}><option value="percent">%</option><option value="flat">₹</option></select></div></Field><Field label="GST breakdown"><div className="flex gap-1 rounded-lg border bg-background p-1"><button type="button" data-testid="button-tax-split" onClick={() => setInvoice((old) => ({ ...old, taxMode: "split" }))} className={`flex-1 rounded-md px-2 py-2 text-[10px] font-bold transition-colors ${invoice.taxMode === "split" ? "bg-secondary text-primary" : "text-muted-foreground"}`}>CGST + SGST</button><button type="button" data-testid="button-tax-igst" onClick={() => setInvoice((old) => ({ ...old, taxMode: "igst" }))} className={`flex-1 rounded-md px-2 py-2 text-[10px] font-bold transition-colors ${invoice.taxMode === "igst" ? "bg-secondary text-primary" : "text-muted-foreground"}`}>IGST</button></div></Field></div>
      </SectionCard>
      <SectionCard icon={Send} eyebrow="A little context" title="Notes & terms">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Note to client" hint="Warm and human"><textarea data-testid="input-notes" className={`${inputClass} min-h-[96px] resize-y`} value={invoice.notes} onChange={(e) => setInvoice((old) => ({ ...old, notes: e.target.value }))} /></Field><Field label="Payment terms"><textarea data-testid="input-terms" className={`${inputClass} min-h-[96px] resize-y`} value={invoice.terms} onChange={(e) => setInvoice((old) => ({ ...old, terms: e.target.value }))} /></Field></div>
      </SectionCard>
    </div>
  );
}

function money(value, currency) {
  const symbols = { INR: "₹", USD: "$", EUR: "€" };
  return `${symbols[currency] || currency} ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dateLabel(value) { if (!value) return "—"; return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
function amountInWords(value, currency) {
  const ones = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const chunk = (number) => {
    if (number < 20) return ones[number];
    if (number < 100) return `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ""}`;
    if (number < 1000) return `${ones[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${chunk(number % 100)}` : ""}`;
    if (number < 1000000) return `${chunk(Math.floor(number / 1000))} Thousand${number % 1000 ? ` ${chunk(number % 1000)}` : ""}`;
    if (number < 1000000000) return `${chunk(Math.floor(number / 1000000))} Million${number % 1000000 ? ` ${chunk(number % 1000000)}` : ""}`;
    return `${chunk(Math.floor(number / 1000000000))} Billion${number % 1000000000 ? ` ${chunk(number % 1000000000)}` : ""}`;
  };
  const rounded = Math.max(0, Math.round(value));
  const currencyName = currency === "INR" ? "Rupees" : currency === "USD" ? "Dollars" : "Euros";
  return `${chunk(rounded)} ${currencyName} Only`;
}

function computeTotal(invoice) {
  const subtotal = invoice.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.rate) || 0), 0);
  const discount = Number(invoice.discount) || 0;
  const discountValue = invoice.discountType === "percent" ? subtotal * Math.max(0, discount) / 100 : Math.max(0, discount);
  const taxable = Math.max(0, subtotal - discountValue);
  const taxValue = invoice.items.reduce((sum, item) => {
    const itemSubtotal = Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.rate) || 0);
    const itemDiscount = subtotal > 0 ? discountValue * (itemSubtotal / subtotal) : 0;
    return sum + Math.max(0, itemSubtotal - itemDiscount) * Math.max(0, item.gstRate ?? invoice.taxRate) / 100;
  }, 0);
  return Math.max(0, taxable + taxValue);
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return null;
}

function InvoicePreview({ invoice, design }) {
  const subtotal = useMemo(() => invoice.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.rate) || 0), 0), [invoice.items]);
  const discount = Number(invoice.discount) || 0;
  const discountValue = invoice.discountType === "percent" ? subtotal * Math.max(0, discount) / 100 : Math.max(0, discount);
  const taxable = Math.max(0, subtotal - discountValue);
  const taxValue = useMemo(() => invoice.items.reduce((sum, item) => {
    const itemSubtotal = Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.rate) || 0);
    const itemDiscount = subtotal > 0 ? discountValue * (itemSubtotal / subtotal) : 0;
    return sum + Math.max(0, itemSubtotal - itemDiscount) * Math.max(0, item.gstRate ?? invoice.taxRate) / 100;
  }, 0), [discountValue, invoice.items, invoice.taxRate, subtotal]);
  const total = taxable + taxValue;
  const upiId = (invoice.upiId || "").trim();
  const upiValid = Boolean(upiId) && /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-_]{1,64}$/.test(upiId);
  const upiUri = upiValid ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=Plivex&am=${total.toFixed(2)}&cu=INR` : "";
  const qrUrl = upiValid ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=${encodeURIComponent(upiUri)}` : "";
  return (
    <div className="flex min-h-full items-start justify-center p-4 sm:p-8 lg:p-10">
      <div data-testid="invoice-preview" className="print-invoice w-full max-w-[794px] overflow-hidden bg-white text-[#28263a] shadow-[0_18px_60px_rgba(34,31,62,0.12)] transition-all">
        <InvoiceDesign
          design={design}
          invoice={invoice}
          subtotal={subtotal}
          discount={discount}
          discountValue={discountValue}
          taxValue={taxValue}
          total={total}
          upiValid={upiValid}
          qrUrl={qrUrl}
          money={money}
          dateLabel={dateLabel}
          amountInWords={amountInWords}
        />
      </div>
    </div>
  );
}

function SignatureModal({ onClose, onSave }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const context = canvas.getContext("2d"); if (!context) return; context.lineWidth = 2.2; context.lineCap = "round"; context.strokeStyle = "#2e2857"; context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); }, []);
  const point = (event) => { const canvas = canvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
  const start = (event) => { const context = canvasRef.current?.getContext("2d"); const p = point(event); if (!context || !p) return; drawing.current = true; context.beginPath(); context.moveTo(p.x, p.y); };
  const move = (event) => { const context = canvasRef.current?.getContext("2d"); const p = point(event); if (!context || !p || !drawing.current) return; context.lineTo(p.x, p.y); context.stroke(); };
  const clear = () => { const canvas = canvasRef.current; const context = canvas?.getContext("2d"); if (canvas && context) { context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); } };
  return (
    <div className="app-chrome fixed inset-0 z-50 flex items-center justify-center bg-[#1f1c35]/45 p-4 backdrop-blur-sm"><div className="w-full max-w-[480px] rounded-2xl border bg-card p-5 text-card-foreground"><div className="flex items-start justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-widest text-primary">Signature block</p><h3 className="mt-1 text-lg font-bold">Sign once, send with confidence.</h3><p className="mt-1 text-xs text-muted-foreground">Draw with your trackpad, mouse or finger.</p></div><button data-testid="button-close-signature" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button></div><div className="mt-5 overflow-hidden rounded-xl border border-dashed bg-white"><canvas data-testid="canvas-signature" ref={canvasRef} width={760} height={220} className="h-[140px] w-full touch-none" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerLeave={() => { drawing.current = false; }} /></div><div className="mt-4 flex items-center justify-between"><button data-testid="button-clear-signature" onClick={clear} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"><RotateCcw className="h-3.5 w-3.5" />Clear canvas</button><div className="flex gap-2"><button data-testid="button-cancel-signature" onClick={onClose} className="rounded-lg border px-3.5 py-2 text-xs font-semibold hover:bg-secondary">Cancel</button><button data-testid="button-save-signature" onClick={() => { if (canvasRef.current) onSave(canvasRef.current.toDataURL("image/png")); onClose(); }} className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground"><Check className="h-3.5 w-3.5" />Use signature</button></div></div></div></div>
  );
}

const PRICING_PLANS = [
  { id: "basic_monthly", name: "Basic Monthly", price: 199, period: "month", amount: 19900, badge: null, accent: false,
    included: ["Up to 50 Invoices & Quotations / month","Dynamic UPI QR Code Generation","Instant WhatsApp Sharing","Standard HD PDF Downloads","Basic Client Database","Expense Tracker","Standard Customer Support"],
    locked: ["GSTR-1 Tax Reports","Custom Business Logo","Multi-Currency Support"] },
  { id: "pro_monthly", name: "Pro Monthly", price: 249, period: "month", amount: 24900, badge: "MOST POPULAR", accent: true,
    included: ["UNLIMITED Invoices, Quotations & Bills","Dynamic UPI QR Code & Online Payments","WhatsApp One-Click Direct Share","Ultra HD PDF Downloads with Custom Logo","Full Client CRM & Lead Pipeline Management","Advanced Expense & Profit/Loss Analytics","GSTR-1 Ready Excel/CSV Exports","Multi-Currency & Tax Breakdown (CGST/SGST/IGST)","Auto Payment Reminders","Priority 24/7 Support"],
    locked: [] },
  { id: "basic_yearly", name: "Basic Yearly", price: 999, period: "year", amount: 99900, badge: "SAVE 58%", accent: false,
    included: ["Includes ALL ₹199 Basic Plan features for 1 FULL YEAR (12 Months Access)","Up to 600 Invoices & Quotations / year","Dynamic UPI QR Codes","Instant WhatsApp Share & HD PDFs","Expense Management","Annual Savings (Cost-effective for individuals)","Standard Support"],
    locked: [] },
  { id: "enterprise_yearly", name: "Enterprise Yearly", price: 1599, period: "year", amount: 159900, badge: "BEST VALUE", accent: true,
    included: ["Includes ALL ₹249 Pro Plan features for 1 FULL YEAR","Custom Invoice Templates & Advanced Branding","Dedicated Account Manager","Multi-User / Team Access","Auto Cloud Backup & Lifetime History","Priority WhatsApp & Call Support"],
    locked: [] },
];

function PricingModal({ onClose, onCheckout, checkoutNotice, currentPlan }) {
  const activePlan = currentPlan?.planId ? PRICING_PLANS.find((plan) => plan.id === currentPlan.planId) : null;
  return (
    <div className="app-chrome fixed inset-0 z-50 flex items-start justify-center bg-[#1f1c35]/55 p-4 backdrop-blur-md sm:items-center">
      <div className="w-full max-w-[620px] overflow-hidden rounded-3xl border bg-card text-card-foreground shadow-[0_30px_120px_rgba(23,18,60,.4)]">
        <div className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-[#4c1d95] p-7 text-primary-foreground">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-12 -left-8 h-40 w-40 rounded-full bg-accent/30 blur-2xl" />
          <button data-testid="button-close-pricing" onClick={onClose} className="absolute right-4 top-4 rounded-lg p-2 text-primary-foreground/80 transition-colors hover:bg-white/10" aria-label="Close pricing"><X className="h-4 w-4" /></button>
          <div className="relative">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><p className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.18em]">Plivex Pro</p></div>
            <h3 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.04em]">Choose your subscription</h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-primary-foreground/85">Unlock unlimited invoices, WhatsApp sharing &amp; premium features.</p>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-5 sm:px-6">
          {currentPlan?.active && (
            <CurrentPlanCard planName={currentPlan.planName} benefits={activePlan?.included || []} startedAt={currentPlan.startedAt} expiresAt={currentPlan.expiresAt} />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {PRICING_PLANS.map((plan) => (
              <div key={plan.id} className={`relative flex flex-col rounded-2xl border p-4 ${plan.accent ? "border-primary bg-primary/[.05]" : "border-border bg-background/40"}`}>
                {plan.badge && <span className={`absolute -top-2.5 right-4 rounded-full px-2.5 py-0.5 font-mono-ui text-[9px] font-bold uppercase tracking-wider text-primary-foreground ${plan.accent ? "bg-primary" : "bg-muted-foreground"}`}>{plan.badge}</span>}
                <p className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">{plan.name}</p>
                <p className="mt-2 text-[26px] font-bold leading-none tracking-[-0.03em]">₹{plan.price}<span className="text-[12px] font-medium text-muted-foreground">/{plan.period}</span></p>
                <div className="mt-3 space-y-1.5">
                  {plan.included.map((f) => <div key={f} className="flex items-start gap-2 text-[11px] font-medium text-foreground"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-2.5 w-2.5" /></span>{f}</div>)}
                  {plan.locked.map((f) => <div key={f} className="flex items-start gap-2 text-[11px] font-medium text-muted-foreground/70"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600"><X className="h-2.5 w-2.5" /></span>{f} (Locked)</div>)}
                </div>
                <button data-testid={`button-checkout-${plan.id}`} onClick={() => onCheckout(plan)} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-bold transition-transform hover:-translate-y-0.5 ${plan.accent ? "bg-primary text-primary-foreground" : "border border-primary text-primary hover:bg-secondary"}`}>{plan.accent ? <Zap className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}Buy ₹{plan.price}/{plan.period}</button>
              </div>
            ))}
          </div>
        </div>
        {checkoutNotice && <div className="mx-6 mb-4 flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3 text-[11px] leading-relaxed text-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-foreground" /><span>{checkoutNotice}</span></div>}
        <div className="border-t px-6 py-4">
          <button data-testid="button-close-pricing-text" onClick={onClose} className="w-full text-center text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">Close</button>
        </div>
        <div className="flex items-center justify-center gap-1 border-t px-6 py-3 text-[10px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />Secure checkout via PayU when configured</div>
      </div>
    </div>
  );
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div className="app-chrome fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-4 py-2.5 text-xs font-semibold text-card-foreground shadow-[0_10px_32px_rgba(38,34,78,.16)] fade-up"><span className={`flex h-5 w-5 items-center justify-center rounded-full ${toast.kind === "success" ? "bg-emerald-100 text-emerald-700" : toast.kind === "error" ? "bg-destructive/15 text-destructive" : "bg-secondary text-primary"}`}>{toast.kind === "success" ? <Check className="h-3 w-3" /> : toast.kind === "error" ? <AlertCircle className="h-3 w-3" /> : <Info className="h-3 w-3" />}</span>{toast.message}<button data-testid="button-close-toast" onClick={onClose} className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-secondary"><X className="h-3 w-3" /></button></div>
  );
}

function WhatsAppNumberModal({ value, onChange, onClose, onSend, sending = false }) {
  return (
    <div className="app-chrome fixed inset-0 z-50 flex items-center justify-center bg-[#1f1c35]/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[410px] rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_22px_90px_rgba(23,18,60,.25)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div><div className="flex items-center gap-2 text-[#25D366]"><MessageCircle className="h-4 w-4" /><p className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.18em]">WhatsApp</p></div><h3 className="mt-2 text-[20px] font-bold tracking-[-0.04em]">Enter Client's WhatsApp Number</h3><p className="mt-1 text-[12px] text-muted-foreground">Include a country code if the number is outside India.</p></div>
          <button data-testid="button-close-whatsapp-modal" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary" aria-label="Close WhatsApp number dialog"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); onSend(); }} className="mt-5">
          <label className="block text-[12px] font-semibold text-muted-foreground">Client WhatsApp Number<input autoFocus data-testid="input-whatsapp-number" type="tel" value={value} onChange={(event) => onChange(event.target.value)} placeholder="+91 98765 43210" className="mt-1.5 w-full rounded-lg border bg-card px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/10" /></label>
          <div className="mt-5 flex justify-end gap-2"><button type="button" data-testid="button-cancel-whatsapp" onClick={onClose} className="rounded-lg border px-3.5 py-2.5 text-[12px] font-semibold text-muted-foreground hover:bg-secondary">Cancel</button><button type="submit" disabled={sending} data-testid="button-send-whatsapp" className="flex items-center gap-2 rounded-lg bg-[#25D366] px-3.5 py-2.5 text-[12px] font-bold text-white hover:-translate-y-0.5 disabled:opacity-70"><MessageCircle className="h-3.5 w-3.5" />{sending ? "Sending…" : "Send"}</button></div>
        </form>
      </div>
    </div>
  );
}

export default function Home() {
  const { canAccess, isPremium, planName, planId, planStartedAt, planExpiresAt } = usePaywall();
  const [invoice, setInvoice] = useStored("invoicepulse-draft", initialInvoice, "invoicepulse-empty-draft-v1");
  const [usageCount, setUsageCount] = useStored("invoicepulse_usage_count", 0);
  const [isDark, setIsDark] = useStored("invoicepulse-dark", false);
  const [mobileTab, setMobileTab] = useState("edit");
  const [pricingOpen, setPricingOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappSending, setWhatsappSending] = useState(false);
  const [checkoutNotice, setCheckoutNotice] = useState("");

  const [toast, setToast] = useState(null);
  const [errors, setErrors] = useState({});
  const toastTimer = useRef(undefined);

  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); }, [isDark]);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);
  // Persistent UPI profile — auto-fills the business profile's saved UPI ID into every new invoice draft & payment QR.
  useEffect(() => {
    try {
      const profile = loadState(KEYS.businessProfile, {});
      const upi = (profile.upiId || "").trim();
      if (upi) setInvoice((old) => ({ ...old, upiId: (old.upiId || "").trim() ? old.upiId : upi }));
    } catch { /* ignore malformed profile */ }
  }, []);
  useEffect(() => {
    try {
      const pending = loadState(KEYS.pendingClient, null);
      if (pending) { setInvoice((old) => ({ ...old, client: { ...old.client, ...pending } })); removeState(KEYS.pendingClient); }
    } catch { /* ignore malformed pending client */ }
  }, []);
  const notify = (message, kind = "success") => { setToast({ message, kind }); if (toastTimer.current) window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 3200); };
  const validate = () => {
    const next = {};
    if (!invoice.business.name.trim()) next.businessName = "This field is required";
    if (!invoice.client.name.trim()) next.clientName = "This field is required";
    invoice.items.forEach((item) => {
      if (!item.description.trim()) next[`item.${item.id}.description`] = "This field is required";
      if (item.rate === "" || item.rate === null || item.rate === undefined) next[`item.${item.id}.rate`] = "Please enter rate";
    });
    if (!invoice.issueDate) next.issueDate = "Please select an invoice date";
    if (!invoice.items.length) next.items = "Add at least one item";
    setErrors(next);
    return Object.keys(next).length === 0;
  };
  const requireValid = () => {
    const valid = validate();
    if (!valid) {
      notify("Please fill all required fields before generating the invoice.", "error");
      setMobileTab("edit");
    }
    return valid;
  };
  const spendCredit = () => {
    if (isPremium) return;
    const next = usageCount + 1;
    setUsageCount(next);
    try { localStorage.setItem("invoicepulse_usage_count", JSON.stringify(next)); } catch { /* best effort */ }
  };
  // Saves the invoice on the server. The server calculates the totals, assigns the next invoice
  // number for this workspace and reduces stock once. Returns the saved invoice's number.
  const recordInvoice = async () => {
    const saved = await saveInvoiceToServer(invoice);
    trackStaffAction({ label: `Invoice ${saved.number} generated for ${invoice.client.name || "client"}`, type: "invoice", revenue: computeTotal(invoice) });
    return saved;
  };
  // Saves first so the PDF / message shows the real server-assigned number.
  const saveAndStampNumber = async () => {
    const saved = await recordInvoice();
    if (saved.number && saved.number !== invoice.number) {
      setInvoice((old) => ({ ...old, number: saved.number }));
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return saved;
  };
  const recordActivity = (label, type = "action") => pushItem(KEYS.activity, { id: genId("act"), type, label, date: new Date().toISOString() });
  const filename = `Plivex_${(invoice.number || "INV-000").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}.pdf`;
  const renderPdfDocument = async () => {
    const preview = document.querySelector("[data-testid='invoice-preview']");
    if (!preview) return null;
    if (preview.offsetParent === null) {
      setMobileTab("preview");
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    }
    const livePreview = document.querySelector("[data-testid='invoice-preview']");
    if (!livePreview) return null;
    const canvas = await html2canvas(livePreview, { scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.setProperties({ title: `Plivex Invoice ${invoice.number || ""}`, subject: "Invoice", creator: "Plivex — Smart Invoicing & Business OS", author: "Plivex" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imageHeight = canvas.height * pageWidth / canvas.width;
    const image = canvas.toDataURL("image/png");
    let remaining = imageHeight;
    let position = 0;
    pdf.addImage(image, "PNG", 0, position, pageWidth, imageHeight);
    remaining -= pageHeight;
    while (remaining > 0) {
      position = remaining - imageHeight;
      pdf.addPage();
      pdf.addImage(image, "PNG", 0, position, pageWidth, imageHeight);
      remaining -= pageHeight;
    }
    return pdf;
  };
  const generatePdf = async (shouldValidate = true) => {
    if (shouldValidate && !requireValid()) return;
    const preview = document.querySelector("[data-testid='invoice-preview']");
    if (!preview) { notify("Preview is still loading. Try again in a moment.", "info"); return; }
    let saved;
    try {
      saved = await saveAndStampNumber();
    } catch (e) {
      notify(e?.message || "The invoice could not be saved. Please try again.", "error");
      return;
    }
    try {
      const pdf = await renderPdfDocument();
      if (!pdf) return;
      const pdfName = `Plivex_${String(saved.number || "INV").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}.pdf`;
      pdf.save(pdfName);
      if (!isPremium) spendCredit();
      recordActivity("Invoice generated");
      notify(`Downloaded ${pdfName}`);
    } catch {
      notify("PDF export failed. Please try again.", "info");
    }
  };
  const download = async () => {
    if (!canAccess("download_pdf")) { setPricingOpen(true); return; }
    if (!requireValid()) return;
    await generatePdf(false);
  };
  // Returning from PayU: premium is now active on the server, so resume the
  // download that the upgrade was started for.
  useEffect(() => {
    if (!isPremium) return;
    let pending = false;
    try { pending = sessionStorage.getItem("plivex:pendingDownload") === "1"; } catch { /* ignore */ }
    if (!pending) return;
    try { sessionStorage.removeItem("plivex:pendingDownload"); } catch { /* ignore */ }
    generatePdf();
  }, [isPremium]);
  const newInvoice = () => { setInvoice({ ...initialInvoice }); setErrors({}); setMobileMenuOpen(false); notify("Fresh invoice started"); };
  const checkout = async (plan) => {
    setCheckoutNotice("");
    // PayU opens a hosted page with a full browser redirect; remember the intent so
    // the download resumes when the verified payment brings the user back here.
    try { sessionStorage.setItem("plivex:pendingDownload", "1"); } catch { /* ignore */ }
    await startPayuCheckout({
      planId: plan.id,
      phone: invoice.client.phone,
      onError: (m) => { setCheckoutNotice(m); try { sessionStorage.removeItem("plivex:pendingDownload"); } catch { /* ignore */ } },
    });
  };
  const handleWhatsApp = () => {
    if (!canAccess("whatsapp_share")) { setPricingOpen(true); return; }
    if (!requireValid()) {
      notify("Please complete all required invoice details before sharing on WhatsApp", "error");
      return;
    }
    const existing = normalizePhone(invoice.client.phone);
    if (existing) {
      sendWhatsApp(existing);
    } else {
      setWhatsappNumber(invoice.client.phone || "");
      setWhatsappOpen(true);
    }
  };
  const sendWhatsApp = async (phone) => {
    if (!canAccess("whatsapp_share")) { setPricingOpen(true); return; }
    if (!requireValid()) { notify("Please complete all required invoice details before sharing on WhatsApp", "error"); return; }
    const digits = normalizePhone(phone);
    if (!digits) { notify("Please enter a valid 10-digit WhatsApp number.", "error"); return; }
    // Open the WhatsApp window synchronously (within the user gesture) to avoid
    // popup blockers, then navigate it to the final URL once the PDF link is ready.
    const waWindow = window.open("", "_blank");
    setWhatsappSending(true);
    notify("Generating your invoice PDF…", "info");
    let savedNumber = invoice.number;
    try {
      savedNumber = (await saveAndStampNumber()).number || savedNumber;
    } catch (e) {
      if (waWindow) waWindow.close();
      setWhatsappSending(false);
      notify(e?.message || "The invoice could not be saved. Please try again.", "error");
      return;
    }
    let pdfLink = "";
    try {
      const pdf = await renderPdfDocument();
      if (pdf) {
        const blob = pdf.output("blob");
        const file = new File([blob], filename, { type: "application/pdf" });
        const { file_url } = await db.integrations.Core.UploadFile({ file });
        pdfLink = file_url || "";
      }
    } catch {
      /* best-effort: continue without a hosted link */
    }
    const cleanPhone = `91${digits}`;
    const clientName = invoice.client.name || "there";
    const invNumber = savedNumber || invoice.number || "INV-000";
    const totalAmt = money(computeTotal(invoice), invoice.currency);
    const due = invoice.dueDate ? dateLabel(invoice.dueDate) : "—";
    const upi = (invoice.upiId || "").trim();
    const bizName = invoice.business.name || "Plivex";
    const paymentLine = upi ? `💳 Payment Details / UPI: ${upi}` : "💳 Payment Details: Please contact us for payment details.";
    const pdfLine = pdfLink ? `📄 View / Download Invoice: ${pdfLink}` : "📄 Your PDF invoice is ready — please request it if not attached.";
    const message = `Hi ${clientName}! 👋\nHope you are doing well!\n\nThank you for your business. Here is your invoice #${invNumber} for ${totalAmt}.\n📅 Due Date: ${due}\n\n${pdfLine}\n${paymentLine}\n\nIf you have any questions, feel free to reply to this message.\nBest regards,\n${bizName}`;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    if (waWindow) { waWindow.location.href = url; } else { window.location.href = url; }
    spendCredit();
    recordActivity("Shared via WhatsApp", "share");
    setWhatsappOpen(false);
    setWhatsappNumber("");
    setWhatsappSending(false);
    setToast(null);
  };
  const activeDesign = !invoice.design || (isPremiumDesign(invoice.design) && !canAccess("premium_designs")) ? DEFAULT_DESIGN_ID : invoice.design;
  return (
    <div className="app-shell flex bg-background">
      <Sidebar onNew={newInvoice} onPricing={() => setPricingOpen(true)} />
      <div className="min-w-0 flex-1">
        <Topbar isDark={isDark} isPremium={isPremium} onToggleTheme={() => setIsDark((value) => !value)} onDownload={download} onWhatsApp={handleWhatsApp} onPricing={() => setPricingOpen(true)} onMenu={() => setMobileMenuOpen(true)} canDownload={canAccess("download_pdf")} canShare={canAccess("whatsapp_share")} planName={planName} whatsappSending={whatsappSending} />
        <MobileMenu open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} onNew={newInvoice} onPricing={() => { setMobileMenuOpen(false); setPricingOpen(true); }} />
        <main className="mx-auto max-w-[1540px] p-4 sm:p-6 lg:p-8">
          <div className="mb-5 flex items-end justify-between gap-4 md:hidden"><div><p className="font-mono-ui text-[10px] uppercase tracking-widest text-primary">Invoice desk</p><h1 className="mt-1 text-[24px] font-bold tracking-[-0.05em]">Make it official.</h1></div><span className="rounded-full border bg-card px-2.5 py-1.5 text-[10px] text-muted-foreground"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />Autosaved</span></div>
          <div className="mb-6 hidden items-end justify-between gap-4 md:flex fade-up"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">The fast billing desk</p><h2 className="mt-1 text-[29px] font-bold tracking-[-0.06em]">Make it official<span className="font-display ml-1 font-normal italic text-primary">.</span></h2><p className="mt-1 text-[12px] text-muted-foreground">Your next professional invoice is already taking shape.</p></div><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Zap className="h-3.5 w-3.5 text-accent-foreground" />Built for the two-minute window</div></div>
          <div className="mb-4 flex rounded-lg border bg-card p-1 md:hidden"><button data-testid="tab-edit-mobile" onClick={() => setMobileTab("edit")} className={`flex-1 rounded-md py-2 text-xs font-bold transition-colors ${mobileTab === "edit" ? "bg-secondary text-primary" : "text-muted-foreground"}`}><FilePenLine className="mr-1.5 inline h-3.5 w-3.5" />Edit invoice</button><button data-testid="tab-preview-mobile" onClick={() => setMobileTab("preview")} className={`flex-1 rounded-md py-2 text-xs font-bold transition-colors ${mobileTab === "preview" ? "bg-secondary text-primary" : "text-muted-foreground"}`}><FileText className="mr-1.5 inline h-3.5 w-3.5" />Preview</button></div>
          <div className="grid items-start gap-6 md:grid-cols-[minmax(390px,0.86fr)_minmax(520px,1.14fr)] xl:gap-8">
            <div className={`${mobileTab === "preview" ? "hidden md:block" : "block"} fade-up fade-up-delay-1`}><InvoiceEditor invoice={invoice} setInvoice={setInvoice} errors={errors} onClearError={(key) => setErrors((current) => { if (!current[key]) return current; const next = { ...current }; delete next[key]; return next; })} onToast={notify} onSignature={() => setSignatureOpen(true)} canAccess={canAccess} onLocked={() => setPricingOpen(true)} design={activeDesign} /></div>
            <div className={`${mobileTab === "edit" ? "hidden md:block" : "block"} sticky top-[86px] fade-up fade-up-delay-2`}><div className="mb-3 flex items-center justify-between px-1"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Live preview</p><p className="mt-0.5 text-[12px] text-muted-foreground">A4 · print-ready · {invoice.currency}</p></div></div><div className="paper-grid min-h-[700px] rounded-xl border bg-[#e9e8f0] dark:bg-[#1e1d2a]"><InvoicePreview invoice={invoice} design={activeDesign} /></div></div>
          </div>
        </main>
      </div>
      {signatureOpen && <SignatureModal onClose={() => setSignatureOpen(false)} onSave={(data) => { setInvoice((old) => ({ ...old, signature: data })); notify("Signature saved"); }} />}
      {pricingOpen && <PricingModal onClose={() => { setPricingOpen(false); setCheckoutNotice(""); }} onCheckout={checkout} checkoutNotice={checkoutNotice} currentPlan={{ active: isPremium, planId, planName, startedAt: planStartedAt, expiresAt: planExpiresAt }} />}
      {whatsappOpen && <WhatsAppNumberModal value={whatsappNumber} onChange={setWhatsappNumber} onClose={() => setWhatsappOpen(false)} onSend={() => sendWhatsApp(whatsappNumber)} sending={whatsappSending} />}
      <PresenceBeacon />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}