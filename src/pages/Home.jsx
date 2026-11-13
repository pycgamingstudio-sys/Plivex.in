import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { KEYS, pushItem, genId, deductStockForInvoice, loadList, loadState, removeState, tenantKey, saveInvoiceToServer } from "@/lib/stores";
import { useAuth } from "@/lib/AuthContext";
import { startCashfreeCheckout } from "@/lib/cashfree";
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
  Mail,
  Menu,
  MessageCircle,
  MessageSquareText,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
const itemDescInputClass = "block w-full min-w-0 max-w-full rounded-lg border bg-card px-3 text-[14px] text-black transition-colors placeholder:text-muted-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/10 sm:px-3.5";
const dateInputClass = "mt-1.5 block h-11 w-full min-w-[150px] cursor-pointer rounded-lg border bg-card px-3 text-[15px] font-medium text-foreground transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10";
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

function openPicker(event) {
  // Open the native calendar straight away on tap/click (no need to aim at the tiny icon).
  try { if (typeof event.currentTarget.showPicker === "function") event.currentTarget.showPicker(); } catch { /* some browsers need a user gesture; typing still works */ }
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

function Topbar({ isDark, isPremium, onToggleTheme, onDownload, onWhatsApp, onEmail, onSms, onPricing, onMenu, canDownload = true, canShare = true, planName = "Free", whatsappSending = false, manualShareBusy = false, pdfDownloading = false }) {
  return (
    <header className="app-chrome sticky top-0 z-20 flex min-w-0 items-center justify-between gap-1 border-b bg-background/90 px-2.5 backdrop-blur-xl sm:gap-3 sm:px-7">
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3"><button data-testid="button-mobile-menu" onClick={onMenu} className="rounded-md p-2 hover:bg-secondary md:hidden"><Menu className="h-5 w-5" /></button><div className="flex items-center gap-2 md:hidden"><Logo className="h-7 w-7" /><p className="text-[15px] font-bold tracking-[-0.04em]">Pli<span className="text-primary">vex</span></p></div><div className="hidden md:block"><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span>Workspace</span><span>/</span><span className="font-medium text-foreground">Invoice desk</span></div><h1 className="mt-0.5 text-[16px] font-bold tracking-[-0.03em]">New invoice <span className="ml-1 rounded-md bg-accent/20 px-1.5 py-0.5 font-mono-ui text-[9px] font-medium text-accent-foreground">DRAFT</span></h1></div></div>
      <div className="ml-auto flex min-w-0 shrink items-center gap-1 sm:gap-3"><div className="hidden items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[11px] text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Saved locally <span className="font-mono-ui text-[10px] text-foreground/70">just now</span></div><div data-testid="usage-badge" className="flex shrink-0 items-center gap-1 rounded-full border bg-card px-1.5 py-1.5 text-[10px] font-semibold sm:gap-1.5 sm:px-2.5 sm:text-[11px]"><Zap className="h-3.5 w-3.5 text-accent-foreground" /><span className="font-mono-ui">{isPremium ? "∞" : "Free"}</span><span className="hidden sm:inline text-muted-foreground">{isPremium ? planName : "Free plan"}</span></div><button data-testid="button-toggle-theme" onClick={onToggleTheme} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground sm:h-9 sm:w-9 transition-colors hover:border-primary/40 hover:text-primary" aria-label="Toggle dark mode">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button><button data-testid="button-pricing-topbar-mobile" onClick={onPricing} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-card text-primary sm:h-9 sm:w-9 transition-colors hover:border-primary/45 sm:hidden" aria-label="Pricing plans"><Sparkles className="h-4 w-4" /></button>
<button data-testid="button-pricing-topbar" onClick={onPricing} className="hidden rounded-lg border px-3 py-2 text-[12px] font-semibold text-foreground transition-colors hover:border-primary/45 hover:text-primary sm:block">{isPremium ? "Pro plan" : "Pricing"}</button><button data-testid="button-whatsapp-topbar" onClick={onWhatsApp} disabled={whatsappSending} className={`flex shrink-0 items-center justify-center gap-1 rounded-lg px-2 py-2.5 text-[12px] font-bold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-70 sm:gap-2 sm:px-3.5 ${canShare ? "bg-[#25D366]" : "bg-muted"}`}><MessageCircle className="h-3.5 w-3.5" /><span className="hidden sm:inline">{whatsappSending ? "Preparing…" : "Send via WhatsApp"}</span>{!canShare && !whatsappSending && <LockKeyhole className="h-3.5 w-3.5" />}</button><DropdownMenu><DropdownMenuTrigger asChild><button type="button" data-testid="button-more-sharing-options" aria-label="More invoice sharing options" title="More sharing options" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60" disabled={manualShareBusy}><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={8} className="z-[60] w-52"><DropdownMenuItem data-testid="menu-share-gmail" onSelect={onEmail} className="cursor-pointer py-2.5"><Mail className="h-4 w-4 text-rose-600" />Share via Gmail{!canShare && <LockKeyhole className="ml-auto h-3.5 w-3.5" />}</DropdownMenuItem><DropdownMenuItem data-testid="menu-share-sms" onSelect={onSms} className="cursor-pointer py-2.5"><MessageSquareText className="h-4 w-4 text-blue-600" />Share via SMS{!canShare && <LockKeyhole className="ml-auto h-3.5 w-3.5" />}</DropdownMenuItem></DropdownMenuContent></DropdownMenu><button data-testid="button-download-topbar" onClick={onDownload} disabled={pdfDownloading} aria-live="polite" className={`flex shrink-0 items-center justify-center gap-1 rounded-lg px-2 py-2.5 text-[12px] font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-80 sm:gap-2 sm:px-3.5 ${canDownload ? "bg-primary" : "bg-muted"}`}><Download className={`h-3.5 w-3.5 ${pdfDownloading ? "animate-pulse" : ""}`} /><span>{pdfDownloading ? "Preparing…" : <><span className="sm:hidden">PDF</span><span className="hidden sm:inline">Download PDF</span></>}</span>{!canDownload && !pdfDownloading && <LockKeyhole className="h-3.5 w-3.5" />}</button></div>
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
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Invoice no."><input data-testid="input-invoice-number" className={inputClass} value={invoice.number} onChange={(e) => setInvoice((old) => ({ ...old, number: e.target.value }))} placeholder="INV-0001 (optional)" /></Field><Field label="Currency"><select data-testid="select-currency" className={`${inputClass} ${!canAccess("multi_currency") ? "opacity-60" : ""}`} disabled={!canAccess("multi_currency")} value={invoice.currency} onChange={(e) => setInvoice((old) => ({ ...old, currency: e.target.value }))}><option value="INR">INR · ₹</option><option value="USD">USD · $</option><option value="EUR">EUR · €</option></select>{!canAccess("multi_currency") && <button type="button" onClick={onLocked} className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"><LockKeyhole className="h-3 w-3" />Unlock Multi-Currency</button>}</Field><Field label="Issue date" error={errors.issueDate}><input data-testid="input-issue-date" type="date" onClick={openPicker} className={withErrorClass(dateInputClass, errors.issueDate)} value={invoice.issueDate} onChange={(e) => { setInvoice((old) => ({ ...old, issueDate: e.target.value })); if (e.target.value) onClearError("issueDate"); }} /></Field><Field label="Due date"><input data-testid="input-due-date" type="date" min={invoice.issueDate || undefined} onClick={openPicker} className={dateInputClass} value={invoice.dueDate} onChange={(e) => setInvoice((old) => ({ ...old, dueDate: e.target.value }))} /></Field></div>
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
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Default GST rate"><div className="relative"><select data-testid="input-tax-rate" className={inputClass} value={invoice.taxRate} onChange={(e) => { const rate = Number(e.target.value); setInvoice((old) => ({ ...old, taxRate: rate, items: old.items.map((item) => ({ ...item, gstRate: rate })) })); }}><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select></div></Field><Field label="Discount"><div className="grid grid-cols-[minmax(0,1fr)_76px] items-start gap-2"><input data-testid="input-discount" aria-label="Discount amount" type="number" inputMode="decimal" min="0" className={`${inputClass} mt-1.5 w-full min-w-0 px-3 text-[16px] font-semibold tabular-nums`} value={invoice.discount} placeholder="0" onChange={(e) => setInvoice((old) => ({ ...old, discount: e.target.value === "" ? "" : Number(e.target.value) }))} /><select data-testid="select-discount-type" aria-label="Discount type" className={`${inputClass} mt-1.5 w-full min-w-0 px-2 text-[15px] font-semibold`} value={invoice.discountType} onChange={(e) => setInvoice((old) => ({ ...old, discountType: e.target.value }))}><option value="percent">%</option><option value="flat">₹</option></select></div></Field><div className="sm:col-span-2"><Field label="GST breakdown"><div className="flex gap-1 rounded-lg border bg-background p-1"><button type="button" data-testid="button-tax-split" onClick={() => setInvoice((old) => ({ ...old, taxMode: "split" }))} className={`flex-1 rounded-md px-2 py-2 text-[10px] font-bold transition-colors ${invoice.taxMode === "split" ? "bg-secondary text-primary" : "text-muted-foreground"}`}>CGST + SGST</button><button type="button" data-testid="button-tax-igst" onClick={() => setInvoice((old) => ({ ...old, taxMode: "igst" }))} className={`flex-1 rounded-md px-2 py-2 text-[10px] font-bold transition-colors ${invoice.taxMode === "igst" ? "bg-secondary text-primary" : "text-muted-foreground"}`}>IGST</button></div></Field></div></div>
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
  // Accept Indian local numbers and international E.164 numbers (without the +).
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith("0")) return digits;
  return null;
}

const INVOICE_WIDTH = 794; // A4 at 96dpi
let pdfLibraryPromise;
const loadPdfLibraries = () => {
  if (!pdfLibraryPromise) {
    pdfLibraryPromise = Promise.all([import("html2canvas"), import("jspdf")]).catch((error) => {
      pdfLibraryPromise = null;
      throw error;
    });
  }
  return pdfLibraryPromise;
};

// Draws the invoice at its true A4 width and shrinks it to fit whatever space is available,
// so the whole preview is always visible without sideways scrolling.
function ScaledPreview({ children }) {
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(undefined);
  useEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return undefined;
    const update = () => {
      const available = wrap.clientWidth;
      if (!available) return; // hidden tab — measure again when it becomes visible
      const next = Math.min(1, available / INVOICE_WIDTH);
      setScale(next);
      setHeight(Math.ceil(inner.offsetHeight * next));
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer) { observer.observe(wrap); observer.observe(inner); }
    window.addEventListener("resize", update);
    return () => { if (observer) observer.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  return (
    <div ref={wrapRef} className="preview-scale-wrap w-full overflow-hidden" style={{ height }}>
      <div ref={innerRef} className="preview-scale-inner" style={{ width: INVOICE_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
    </div>
  );
}

export function InvoicePreview({ invoice, design }) {
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
  const upiUri = upiValid ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(invoice.business.name || "Business")}&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Invoice ${invoice.number || ""}`)}` : "";
  const qrUrl = upiValid ? `https://quickchart.io/qr?size=600&margin=2&ecLevel=Q&text=${encodeURIComponent(upiUri)}` : "";
  return (
    <div className="p-2 sm:p-4">
      <ScaledPreview>
      <div data-testid="invoice-preview" className="print-invoice w-[794px] overflow-hidden bg-white text-[#28263a] shadow-[0_18px_60px_rgba(34,31,62,0.12)]">
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
      </ScaledPreview>
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
    included: ["Up to 3,000 invoices per month","Dynamic UPI QR Code & Online Payments","WhatsApp, Gmail & SMS Manual Invoice Sharing","Ultra HD PDF Downloads with Custom Logo","Full Client CRM & Lead Pipeline Management","Advanced Expense & Profit/Loss Analytics","GSTR-1 Ready Excel/CSV Exports","Multi-Currency & Tax Breakdown (CGST/SGST/IGST)","Auto Payment Reminders"],
    locked: [] },
  { id: "basic_yearly", name: "Basic Yearly", price: 999, period: "year", amount: 99900, badge: "SAVE 58%", accent: false,
    included: ["Includes ALL ₹199 Basic Plan features for 1 FULL YEAR (12 Months Access)","Up to 600 Invoices & Quotations / year","Dynamic UPI QR Codes","Instant WhatsApp Share & HD PDFs","Expense Management","Annual Savings (Cost-effective for individuals)","Standard Support"],
    locked: [] },
  { id: "enterprise_yearly", name: "Enterprise Yearly", price: 1599, period: "year", amount: 159900, badge: "BEST VALUE", accent: true,
    included: ["Pro plan features for one year","Custom Invoice Templates & Advanced Branding","Multi-User / Team Access","Cloud-synced business records","Priority WhatsApp & Call Support"],
    locked: [] },
];

function PricingModal({ onClose, onCheckout, checkoutNotice, currentPlan, userEmail }) {
  const isVirendraAccount = String(userEmail || "").trim().toLowerCase() === "virendra.sharma99978@gmail.com";
  const displayPlans = PRICING_PLANS.map((plan) => isVirendraAccount && plan.id === "basic_monthly" ? { ...plan, price: 25, amount: 2500, badge: "SPECIAL PRICE" } : plan);
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
            {displayPlans.map((plan) => (
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
        <div className="flex items-center justify-center gap-1 border-t px-6 py-3 text-[10px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />Secure checkout via Cashfree</div>
      </div>
    </div>
  );
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div className="app-chrome fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 z-[60] flex max-w-[calc(100vw-24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full border bg-card px-3 py-2.5 text-[11px] font-semibold text-card-foreground shadow-[0_10px_32px_rgba(38,34,78,.16)] fade-up sm:bottom-5 sm:px-4 sm:text-xs"><span className={`flex h-5 w-5 items-center justify-center rounded-full ${toast.kind === "success" ? "bg-emerald-100 text-emerald-700" : toast.kind === "error" ? "bg-destructive/15 text-destructive" : "bg-secondary text-primary"}`}>{toast.kind === "success" ? <Check className="h-3 w-3" /> : toast.kind === "error" ? <AlertCircle className="h-3 w-3" /> : <Info className="h-3 w-3" />}</span>{toast.message}<button data-testid="button-close-toast" onClick={onClose} className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-secondary"><X className="h-3 w-3" /></button></div>
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
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { canAccess, isPremium, planName, planId, planStartedAt, planExpiresAt, limits, usage, remaining, openPaywall, refreshAccessStatus } = usePaywall();
  const [invoice, setInvoice] = useStored("invoicepulse-draft", initialInvoice, "invoicepulse-empty-draft-v1");
  const [isDark, setIsDark] = useStored("invoicepulse-dark", false);
  const [mobileTab, setMobileTab] = useState("edit");
  const [pricingOpen, setPricingOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappSending, setWhatsappSending] = useState(false);
  const [manualShareBusy, setManualShareBusy] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [checkoutNotice, setCheckoutNotice] = useState("");

  const [toast, setToast] = useState(null);
  const [errors, setErrors] = useState({});
  const toastTimer = useRef(undefined);

  useEffect(() => {
    let idleId;
    let timerId;
    const warmPdfTools = () => { void loadPdfLibraries().catch(() => {}); };
    if ("requestIdleCallback" in window) idleId = window.requestIdleCallback(warmPdfTools, { timeout: 1800 });
    else timerId = window.setTimeout(warmPdfTools, 900);
    return () => {
      if (idleId !== undefined && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); }, [isDark]);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);
  // Business profile is the single source of defaults for every invoice.
  // Fill only blank fields so a user's invoice-specific edits are never overwritten.
  const applyBusinessProfile = (invoiceDraft) => {
    const profile = loadState(KEYS.businessProfile, {}) || {};
    const business = invoiceDraft.business || {};
    return {
      ...invoiceDraft,
      business: {
        ...business,
        name: business.name || profile.name || "",
        email: business.email || profile.email || "",
        phone: business.phone || profile.phone || "",
        gstin: business.gstin || profile.gstin || "",
        address: business.address || profile.address || "",
      },
      logo: invoiceDraft.logo || profile.logo || "",
      upiId: invoiceDraft.upiId || profile.upiId || "",
    };
  };
  useEffect(() => {
    setInvoice((old) => applyBusinessProfile(old));
  }, [user?.id]);
  useEffect(() => {
    try {
      const pending = loadState(KEYS.pendingClient, null);
      if (pending) { setInvoice((old) => ({ ...old, client: { ...old.client, ...pending } })); removeState(KEYS.pendingClient); }
    } catch { /* ignore malformed pending client */ }
  }, []);
  const notify = (message, kind = "success", duration = 3200) => { setToast({ message, kind }); if (toastTimer.current) window.clearTimeout(toastTimer.current); toastTimer.current = duration > 0 ? window.setTimeout(() => setToast(null), duration) : undefined; };
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
  const recordInvoice = async () => {
    const total = computeTotal(invoice);
    const taxValue = Math.max(0, total - invoice.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.rate) || 0), 0));
    const savedInvoice = await saveInvoiceToServer({ ...invoice, total, taxValue });
    await refreshAccessStatus();
    trackStaffAction({ label: `Invoice ${savedInvoice.number || invoice.number || "INV"} generated for ${invoice.client.name || "client"}`, type: "invoice", revenue: total });
    return savedInvoice;
  };
  const recordActivity = (label, type = "action") => pushItem(KEYS.activity, { id: genId("act"), type, label, date: new Date().toISOString() });
  const filename = `Plivex_${(invoice.number || "INV-000").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}.pdf`;
  const renderPdfDocument = async () => {
    const source = document.querySelector("[data-testid='invoice-preview']");
    if (!source) return null;
    const [{ default: html2canvas }, { jsPDF }] = await loadPdfLibraries();
    const stage = document.createElement("div");
    stage.style.cssText = `position:fixed;left:0;top:0;width:${INVOICE_WIDTH}px;z-index:-1;pointer-events:none;background:#fff;`;
    const copy = source.cloneNode(true);
    copy.style.width = `${INVOICE_WIDTH}px`;
    stage.appendChild(copy);
    document.body.appendChild(stage);
    let canvas;
    let qrBounds = null;
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const images = [...copy.querySelectorAll("img")];
      await Promise.all(images.map((img) => img.decode?.().catch(() => undefined)));
      const qrImage = copy.querySelector('img[alt="UPI payment QR code"]');
      if (qrImage && !qrImage.naturalWidth) throw new Error("UPI QR image could not be loaded. Check your connection and retry the PDF.");
      const base = copy.getBoundingClientRect();
      const keepTogether = [...copy.querySelectorAll('[data-pdf-keep-together="upi"]')].map((section) => {
        const box = section.getBoundingClientRect();
        return { top: Math.max(0, box.top - base.top), bottom: Math.max(0, box.bottom - base.top) };
      });
      canvas = await html2canvas(copy, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, windowWidth: INVOICE_WIDTH, imageTimeout: 5000 });
      const scaleRatio = canvas.width / INVOICE_WIDTH;
      qrBounds = keepTogether.map((bounds) => ({ top: Math.floor(bounds.top * scaleRatio), bottom: Math.ceil(bounds.bottom * scaleRatio) }));
    } finally {
      document.body.removeChild(stage);
    }
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    pdf.setProperties({ title: `Plivex Invoice ${invoice.number || ""}`, subject: "Invoice", creator: "Plivex — Smart Invoicing & Business OS", author: "Plivex" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const addPdfFooters = () => {
      const pages = pdf.getNumberOfPages();
      const footerMargin = 8;
      for (let page = 1; page <= pages; page += 1) {
        pdf.setPage(page);
        pdf.setFontSize(7);
        pdf.setTextColor(120);
        if (planName === "Free") pdf.text("Made with Plivex", footerMargin, pageHeight - 4);
        pdf.text(`Page ${page} of ${pages}`, pageWidth - footerMargin, pageHeight - 4, { align: "right" });
      }
    };
    const toPng = (c) => c.toDataURL("image/png");
    // Always produce exactly one A4 sheet. Fit the complete invoice proportionally
    // inside printable margins instead of splitting totals/UPI blocks onto page two.
    const marginX = 7;
    const marginTop = 7;
    const marginBottom = 12;
    const fitScale = Math.min((pageWidth - marginX * 2) / canvas.width, (pageHeight - marginTop - marginBottom) / canvas.height);
    const fittedWidth = canvas.width * fitScale;
    const fittedHeight = canvas.height * fitScale;
    const x = (pageWidth - fittedWidth) / 2;
    const y = marginTop + Math.max(0, (pageHeight - marginTop - marginBottom - fittedHeight) / 2);
    pdf.addImage(toPng(canvas), "PNG", x, y, fittedWidth, fittedHeight, undefined, "FAST");
    addPdfFooters();
    return pdf;
  };
  const generatePdf = async (shouldValidate = true) => {
    if (shouldValidate && !requireValid()) return;
    const preview = document.querySelector("[data-testid='invoice-preview']");
    if (!preview) { notify("Preview is still loading. Try again in a moment.", "info"); return; }
    try {
      notify("Download pending — preparing your invoice PDF…", "info", 0);
      notify("Preparing invoice PDF… please wait.", "info", 0);
      // PDF rendering is CPU-bound while invoice persistence is network-bound.
      // Run both together to avoid adding their wait times sequentially.
      const [, pdf] = await Promise.all([recordInvoice(), renderPdfDocument()]);
      if (!pdf) return;
      notify("PDF ready — starting download…", "info", 0);
      pdf.save(filename);
      deductStockForInvoice(invoice);
      recordActivity("Invoice generated");
      notify(`Downloaded ${filename}`);
    } catch (error) {
      const message = String(error?.message || "");
      if (message.startsWith("PLAN_LIMIT_REACHED|")) openPaywall("Invoice limit reached: " + message.split("|").slice(1).join(" · "));
      else if (message.startsWith("PLAN_FEATURE_LOCKED|")) openPaywall("This feature requires an upgrade: " + message.split("|").slice(1).join(" · "));
      else notify(message || "PDF export failed. Please try again.", "error");
    }
  };
  const download = async () => {
    if (pdfDownloading) return;
    if (Number.isFinite(remaining("invoices_monthly")) && remaining("invoices_monthly") <= 0 || Number.isFinite(remaining("invoices")) && remaining("invoices") <= 0) { openPaywall("Invoice limit reached for your current plan."); return; }
    if (!requireValid()) return;
    setPdfDownloading(true);
    notify("Download pending — your invoice is being prepared…", "info", 0);
    try { await generatePdf(false); }
    finally { setPdfDownloading(false); }
  };
  // Returning from Cashfree: premium is now active on the server, so resume the
  // download that the upgrade was started for.
  useEffect(() => {
    if (!isPremium) return;
    let pending = false;
    try { pending = sessionStorage.getItem("plivex:pendingDownload") === "1"; } catch { /* ignore */ }
    if (!pending) return;
    try { sessionStorage.removeItem("plivex:pendingDownload"); } catch { /* ignore */ }
    generatePdf();
  }, [isPremium]);
  const newInvoice = () => { setInvoice(applyBusinessProfile({ ...initialInvoice, items: [{ ...initialInvoice.items[0], id: `item-${Date.now()}` }] })); setErrors({}); setMobileMenuOpen(false); setMobileTab("edit"); notify("Fresh invoice started with your saved business details"); };
  useEffect(() => {
    if (!location.state?.newInvoice) return;
    newInvoice();
    navigate(location.pathname, { replace: true, state: null });
  }, [location.key]);
  const checkout = async (plan) => {
    setCheckoutNotice("");
    // Cashfree opens a hosted page with a full browser redirect; remember the intent so
    // the download resumes when the verified payment brings the user back here.
    try { sessionStorage.setItem("plivex:pendingDownload", "1"); } catch { /* ignore */ }
    try {
      await startCashfreeCheckout({ planId: plan.id });
    } catch (error) {
      setCheckoutNotice(error?.message || "Cashfree checkout could not be started. Please try again.");
      try { sessionStorage.removeItem("plivex:pendingDownload"); } catch { /* ignore */ }
    }
  };
  const handleWhatsApp = () => {
    if (!canAccess("whatsapp_share")) { openPaywall("WhatsApp sharing is available on Pro."); return; }
    if ((Number.isFinite(remaining("invoices_monthly")) && remaining("invoices_monthly") <= 0) || (Number.isFinite(remaining("invoices")) && remaining("invoices") <= 0)) { openPaywall("Invoice limit reached for your current plan."); return; }
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
    if (!canAccess("whatsapp_share")) { openPaywall("WhatsApp sharing is available on Pro."); return; }
    if ((Number.isFinite(remaining("invoices_monthly")) && remaining("invoices_monthly") <= 0) || (Number.isFinite(remaining("invoices")) && remaining("invoices") <= 0)) { openPaywall("Invoice limit reached for your current plan."); return; }
    if (!requireValid()) { notify("Please complete all required invoice details before sharing on WhatsApp", "error"); return; }
    const digits = normalizePhone(phone);
    if (!digits) { notify("Please enter a valid WhatsApp number with its country code.", "error"); return; }
    // Open the WhatsApp window synchronously (within the user gesture) to avoid
    // popup blockers, then navigate it to the final URL once the PDF link is ready.
    const waWindow = window.open("", "_blank");
    setWhatsappSending(true);
    notify("Saving invoice and preparing PDF…", "info", 0);
    try {
      // Persist first: the server assigns the official invoice number and deducts stock
      // exactly once. This prevents WhatsApp sharing from creating an unsaved invoice.
      const savedInvoice = await recordInvoice();
      if (savedInvoice?.number && savedInvoice.number !== invoice.number) {
        setInvoice((current) => ({ ...current, number: savedInvoice.number }));
        // Let React update the visible invoice preview before rasterizing it.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      const pdf = await renderPdfDocument();
      if (!pdf) throw new Error("Invoice preview is not ready. Please try again.");
      const safeNumber = savedInvoice?.number || invoice.number || "INV-000";
      const safeFilename = `Plivex_${String(safeNumber).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}.pdf`;
      const blob = pdf.output("blob");
      const file = new File([blob], safeFilename, { type: "application/pdf" });
      const clientName = invoice.client.name || "there";
      const totalAmt = money(computeTotal(invoice), invoice.currency);
      const due = invoice.dueDate ? dateLabel(invoice.dueDate) : "—";
      const upi = (invoice.upiId || "").trim();
      const bizName = invoice.business.name || "Plivex";
      const paymentLine = upi ? `💳 Payment Details / UPI: ${upi}` : "💳 Payment Details: Please contact us for payment details.";
      const message = `Hi ${clientName}! 👋\nHope you are doing well!\n\nThank you for your business. Here is your invoice #${safeNumber} for ${totalAmt}.\n📅 Due Date: ${due}\n${paymentLine}\n\nIf you have any questions, feel free to reply to this message.\nBest regards,\n${bizName}`;

      // On supported phones, share the actual PDF file through the native share sheet.
      let canShareFile = false;
      try {
        canShareFile = typeof navigator.share === "function"
          && typeof navigator.canShare === "function"
          && navigator.canShare({ files: [file] });
      } catch { canShareFile = false; }
      if (canShareFile) {
        try {
          await navigator.share({ files: [file], title: `Invoice ${safeNumber}`, text: message });
          if (waWindow) waWindow.close();
          recordActivity("Shared invoice PDF", "share");
          setWhatsappOpen(false);
          setWhatsappNumber("");
          notify("Invoice PDF shared. Confirm the recipient and tap Send in WhatsApp.");
          return;
        } catch (shareError) {
          if (shareError?.name === "AbortError") throw shareError;
          // Some browsers expose file sharing but reject it at runtime; use the
          // reliable download + WhatsApp text fallback below.
        }
      }

      // Fallback: download the PDF and open WhatsApp with text. Never put a data: URL
      // in the message because it is not a public download link.
      pdf.save(safeFilename);
      const fallbackMessage = `${message}\n\n📎 The invoice PDF has been downloaded. Please attach it from your Downloads before sending.`;
      const url = `https://wa.me/${digits}?text=${encodeURIComponent(fallbackMessage)}`;
      if (waWindow) waWindow.location.href = url;
      else window.location.href = url;
      recordActivity("Prepared WhatsApp invoice message", "share");
      setWhatsappOpen(false);
      setWhatsappNumber("");
      notify("PDF downloaded and WhatsApp opened. Attach the PDF before tapping Send.");
    } catch (error) {
      if (waWindow) waWindow.close();
      if (error?.name === "AbortError") notify("Sharing cancelled. The invoice is saved; you can share it again anytime.", "info");
      else {
        const message = String(error?.message || "");
        if (message.startsWith("PLAN_LIMIT_REACHED|")) openPaywall("Invoice limit reached: " + message.split("|").slice(1).join(" · "));
        else if (message.startsWith("PLAN_FEATURE_LOCKED|")) openPaywall("This feature requires an upgrade: " + message.split("|").slice(1).join(" · "));
        else notify(message || "Could not prepare the invoice for WhatsApp. Please try again.", "error");
      }
    } finally {
      setWhatsappSending(false);
    }
  };
  const shareViaEmailOrSms = async (channel) => {
    if (!canAccess("whatsapp_share")) { openPaywall("Gmail and SMS invoice sharing are available on Pro."); return; }
    if (manualShareBusy || whatsappSending || pdfDownloading) return;
    if ((Number.isFinite(remaining("invoices_monthly")) && remaining("invoices_monthly") <= 0) || (Number.isFinite(remaining("invoices")) && remaining("invoices") <= 0)) { openPaywall("Invoice limit reached for your current plan."); return; }
    if (!requireValid()) { notify("Please complete all required invoice details before sharing.", "error"); return; }

    const email = String(invoice.client.email || "").trim();
    const phone = normalizePhone(invoice.client.phone);
    if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      notify("Add a valid customer email in the invoice details first.", "error");
      return;
    }
    if (channel === "sms" && !phone) {
      notify("Add a valid customer mobile number with country code in the invoice details first.", "error");
      return;
    }

    setManualShareBusy(true);
    notify("Saving invoice and preparing PDF…", "info", 0);
    try {
      const savedInvoice = await recordInvoice();
      if (savedInvoice?.number && savedInvoice.number !== invoice.number) {
        setInvoice((current) => ({ ...current, number: savedInvoice.number }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      const pdf = await renderPdfDocument();
      if (!pdf) throw new Error("Invoice preview is not ready. Please try again.");
      const safeNumber = savedInvoice?.number || invoice.number || "INV-000";
      const safeFilename = `Plivex_${String(safeNumber).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}.pdf`;
      pdf.save(safeFilename);

      const clientName = invoice.client.name || "there";
      const totalAmt = money(computeTotal(invoice), invoice.currency);
      const due = invoice.dueDate ? dateLabel(invoice.dueDate) : "—";
      const upi = (invoice.upiId || "").trim();
      const bizName = invoice.business.name || "Plivex";
      const paymentLine = upi ? `Payment Details / UPI: ${upi}` : "Please contact us for payment details.";
      const body = channel === "email"
        ? `Hi ${clientName},\n\nPlease find the details for invoice #${safeNumber}.\nInvoice amount: ${totalAmt}\nDue date: ${due}\n${paymentLine}\n\nThe invoice PDF has been downloaded. Please attach the PDF before sending this email.\n\nRegards,\n${bizName}`
        : `Hi ${clientName}, invoice #${safeNumber} from ${bizName}. Amount: ${totalAmt}. Due: ${due}. ${paymentLine} Invoice PDF downloaded separately; attach it if your SMS app supports attachments.`;
      if (channel === "email") {
        const subject = `Invoice ${safeNumber} from ${bizName}`;
        window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        recordActivity("Prepared invoice email", "share");
        notify("Email app opened with the invoice details. Attach the downloaded PDF, then tap Send.");
      } else {
        window.location.href = `sms:${phone}?body=${encodeURIComponent(body)}`;
        recordActivity("Prepared invoice SMS", "share");
        notify("SMS app opened with the invoice details. Attach the downloaded PDF if supported, then tap Send.");
      }
    } catch (error) {
      const message = String(error?.message || "");
      if (message.startsWith("PLAN_LIMIT_REACHED|")) openPaywall("Invoice limit reached: " + message.split("|").slice(1).join(" · "));
      else if (message.startsWith("PLAN_FEATURE_LOCKED|")) openPaywall("This feature requires an upgrade: " + message.split("|").slice(1).join(" · "));
      else notify(message || "Could not prepare invoice sharing. Please try again.", "error");
    } finally {
      setManualShareBusy(false);
    }
  };
  const activeDesign = !invoice.design || (isPremiumDesign(invoice.design) && !canAccess("premium_designs")) ? DEFAULT_DESIGN_ID : invoice.design;
  return (
    <div className="app-shell flex bg-background">
      <Sidebar onNew={newInvoice} onPricing={() => setPricingOpen(true)} />
      <div className="min-w-0 flex-1">
        <Topbar isDark={isDark} isPremium={isPremium} onToggleTheme={() => setIsDark((value) => !value)} onDownload={download} onWhatsApp={handleWhatsApp} onEmail={() => shareViaEmailOrSms("email")} onSms={() => shareViaEmailOrSms("sms")} onPricing={() => setPricingOpen(true)} onMenu={() => setMobileMenuOpen(true)} canDownload={canAccess("download_pdf") && (!Number.isFinite(remaining("invoices_monthly")) || remaining("invoices_monthly") > 0) && (!Number.isFinite(remaining("invoices")) || remaining("invoices") > 0)} canShare={canAccess("whatsapp_share")} planName={planName} whatsappSending={whatsappSending} manualShareBusy={manualShareBusy} pdfDownloading={pdfDownloading} />
        <MobileMenu open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} onNew={newInvoice} onPricing={() => { setMobileMenuOpen(false); setPricingOpen(true); }} />
        <main className="mx-auto max-w-[1540px] p-4 sm:p-6 lg:p-8">
          <div className="mb-5 flex items-end justify-between gap-4 md:hidden"><div><p className="font-mono-ui text-[10px] uppercase tracking-widest text-primary">Invoice desk</p><h1 className="mt-1 text-[24px] font-bold tracking-[-0.05em]">Make it official.</h1></div><span className="rounded-full border bg-card px-2.5 py-1.5 text-[10px] text-muted-foreground"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />Autosaved</span></div>
          <div className="mb-6 hidden items-end justify-between gap-4 md:flex fade-up"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">The fast billing desk</p><h2 className="mt-1 text-[29px] font-bold tracking-[-0.06em]">Make it official<span className="font-display ml-1 font-normal italic text-primary">.</span></h2><p className="mt-1 text-[12px] text-muted-foreground">Your next professional invoice is already taking shape.</p></div><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Zap className="h-3.5 w-3.5 text-accent-foreground" />Built for the two-minute window</div></div>
          <div className="mb-4 rounded-xl border bg-card p-3"><div className="flex items-center justify-between text-xs"><span className="font-semibold">Invoices this month</span><span className="font-bold">{Number(usage.invoices_monthly ?? usage.invoices ?? 0)}/{Number(limits.invoices_monthly ?? limits.invoices ?? 30)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${Number(usage.invoices_monthly ?? usage.invoices ?? 0) >= Number(limits.invoices_monthly ?? limits.invoices ?? 30) ? "bg-rose-500" : Number(usage.invoices_monthly ?? usage.invoices ?? 0) / Number(limits.invoices_monthly ?? limits.invoices ?? 30) >= 0.8 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, Number(usage.invoices_monthly ?? usage.invoices ?? 0) / Number(limits.invoices_monthly ?? limits.invoices ?? 30) * 100)}%` }} /></div>{Number(usage.invoices_monthly ?? usage.invoices ?? 0) / Number(limits.invoices_monthly ?? limits.invoices ?? 30) >= 0.8 && <p className="mt-1.5 text-[11px] text-amber-600">{Number(usage.invoices_monthly ?? usage.invoices ?? 0) >= Number(limits.invoices_monthly ?? limits.invoices ?? 30) ? "Plan limit reached" : "Usage limit warning"}</p>}{Number(usage.invoices_monthly ?? usage.invoices ?? 0) >= Number(limits.invoices_monthly ?? limits.invoices ?? 30) && <button onClick={() => openPaywall("Invoice limit reached for your current plan.")} className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">Upgrade</button>}</div><div className="mb-4 flex rounded-lg border bg-card p-1 xl:hidden"><button data-testid="tab-edit-mobile" onClick={() => setMobileTab("edit")} className={`flex-1 rounded-md py-2 text-xs font-bold transition-colors ${mobileTab === "edit" ? "bg-secondary text-primary" : "text-muted-foreground"}`}><FilePenLine className="mr-1.5 inline h-3.5 w-3.5" />Edit invoice</button><button data-testid="tab-preview-mobile" onClick={() => setMobileTab("preview")} className={`flex-1 rounded-md py-2 text-xs font-bold transition-colors ${mobileTab === "preview" ? "bg-secondary text-primary" : "text-muted-foreground"}`}><FileText className="mr-1.5 inline h-3.5 w-3.5" />Preview</button></div>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] xl:gap-8">
            <div className={`${mobileTab === "preview" ? "hidden xl:block" : "block"} min-w-0 fade-up fade-up-delay-1`}><InvoiceEditor invoice={invoice} setInvoice={setInvoice} errors={errors} onClearError={(key) => setErrors((current) => { if (!current[key]) return current; const next = { ...current }; delete next[key]; return next; })} onToast={notify} onSignature={() => setSignatureOpen(true)} canAccess={canAccess} onLocked={() => setPricingOpen(true)} design={activeDesign} /></div>
            <div className={`${mobileTab === "edit" ? "hidden xl:block" : "block"} min-w-0 xl:sticky xl:top-[86px] fade-up fade-up-delay-2`}><div className="mb-3 flex items-center justify-between px-1"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Live preview</p><p className="mt-0.5 text-[12px] text-muted-foreground">A4 · print-ready · {invoice.currency}</p></div></div><div className="paper-grid min-w-0 rounded-xl border bg-[#e9e8f0] dark:bg-[#1e1d2a] xl:max-h-[calc(100dvh-170px)] xl:overflow-y-auto"><InvoicePreview invoice={invoice} design={activeDesign} /></div></div>
          </div>
        </main>
      </div>
      {signatureOpen && <SignatureModal onClose={() => setSignatureOpen(false)} onSave={(data) => { setInvoice((old) => ({ ...old, signature: data })); notify("Signature saved"); }} />}
      {pricingOpen && <PricingModal onClose={() => { setPricingOpen(false); setCheckoutNotice(""); }} onCheckout={checkout} checkoutNotice={checkoutNotice} userEmail={user?.email} currentPlan={{ active: isPremium, planId, planName, startedAt: planStartedAt, expiresAt: planExpiresAt }} />}
      {whatsappOpen && <WhatsAppNumberModal value={whatsappNumber} onChange={setWhatsappNumber} onClose={() => setWhatsappOpen(false)} onSend={() => sendWhatsApp(whatsappNumber)} sending={whatsappSending} />}
      <PresenceBeacon />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}