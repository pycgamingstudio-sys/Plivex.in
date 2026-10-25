import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Package, Users, FileCheck2, Settings, TrendingUp, CheckCircle2, Clock, Sparkles, LogIn, Boxes } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import AuthModal from "@/components/AuthModal";
import Logo from "@/components/Logo";
import AboutSection from "@/components/landing/AboutSection";
import PricingSection from "@/components/landing/PricingSection";

const DEMO_INVOICES = [
  { id: 1, number: "INV-2026-0141", client: "Sharma Traders", amount: "₹48,700.00", status: "Paid" },
  { id: 2, number: "INV-2026-0142", client: "Nair & Co", amount: "₹23,940.00", status: "Pending" },
  { id: 3, number: "INV-2026-0143", client: "Vikram Enterprises", amount: "₹1,12,250.00", status: "Paid" },
  { id: 4, number: "INV-2026-0144", client: "Mehta Retail", amount: "₹9,440.00", status: "Pending" },
];

const TREND = [
  { day: "Mon", sales: 12400 },
  { day: "Tue", sales: 18900 },
  { day: "Wed", sales: 9200 },
  { day: "Thu", sales: 22600 },
  { day: "Fri", sales: 17450 },
  { day: "Sat", sales: 28100 },
  { day: "Sun", sales: 15800 },
];

const ACTIONS = [
  { id: "create-invoice", label: "Create Invoice", desc: "GST-ready, print-perfect PDFs in under a minute.", icon: FileText, gradient: "bg-gradient-to-br from-[#EDE9FE] to-[#DDD6FE]" },
  { id: "add-stock", label: "Add Stock", desc: "Inventory auto-deducts on every bill you raise.", icon: Package, gradient: "bg-gradient-to-br from-[#FEE2E2] to-[#FECACA]" },
  { id: "open-crm", label: "Open CRM", desc: "Client directory and lead pipeline in one place.", icon: Users, gradient: "bg-gradient-to-br from-[#FAE8FF] to-[#F5D0FE]" },
  { id: "export-gst", label: "Export GST", desc: "GSTR-1 registers and Tally-ready exports.", icon: FileCheck2, gradient: "bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE]" },
  { id: "settings", label: "Open Settings", desc: "Workspace defaults, team roles and branding.", icon: Settings, gradient: "bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A]" },
];

function DemoCard({ icon: Icon, label, value, sub, gradient }) {
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${gradient} p-4 text-white shadow-sm`}>
      <div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wider text-white/75">{label}</span><Icon className="h-4 w-4 text-white/85" /></div>
      <p className="mt-2 text-[20px] font-bold leading-none">{value}</p>
      <p className="mt-1.5 text-[11px] text-white/80">{sub}</p>
    </div>
  );
}

export default function GuestDashboard() {
  const [authAction, setAuthAction] = useState(null);

  const requireAuth = (action) => {
    try { sessionStorage.setItem("plivex:pendingAction", action.id); } catch { /* ignore */ }
    setAuthAction(action.label);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-[#E5E7EB] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Logo className="h-9 w-9" rounded="rounded-xl" />
            <div><p className="text-[15px] font-bold tracking-[-0.03em]">Plivex</p><p className="text-[10px] text-slate-400">Smart Invoicing &amp; Business OS</p></div>
          </div>
          <nav aria-label="Main navigation" className="hidden items-center gap-4 lg:flex">
            <Link to="/features" className="text-sm font-semibold text-slate-600 hover:text-[#6D28D9]">Features</Link>
            <Link to="/about" className="text-sm font-semibold text-slate-600 hover:text-[#6D28D9]">About</Link>
            <Link to="/pricing" className="text-sm font-semibold text-slate-600 hover:text-[#6D28D9]">Pricing</Link>
            <Link to="/contact-us" className="text-sm font-semibold text-slate-600 hover:text-[#6D28D9]">Contact</Link>
          </nav>
          <div className="flex items-center gap-2">
            <LanguageSwitcher className="hidden sm:inline-flex" />
            <button onClick={() => setAuthAction("")} className="rounded-xl border border-[#E5E7EB] px-3 py-2 text-[12px] font-bold text-slate-700 hover:bg-slate-50">Sign in</button>
            <Link to="/register" className="rounded-xl bg-[#6D28D9] px-3 py-2 text-[12px] font-bold text-white hover:bg-[#7C3AED]">Get started</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 pb-16 pt-6 sm:pt-8">
        <section className="fade-up overflow-hidden rounded-3xl bg-gradient-to-br from-[#4C1D95] via-[#6D28D9] to-[#7C3AED] text-white shadow-lg">
          <div className="grid items-center gap-7 p-6 sm:p-9 lg:grid-cols-[1.1fr_0.9fr] lg:p-12">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white/90"><Sparkles className="h-3.5 w-3.5" />Smart business workspace</p>
              <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:text-5xl">Less paperwork.<br/><span className="text-violet-200">More business.</span></h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/85 sm:text-base">Create invoices and quotations, organise clients, track expenses and stock, and explore the Plivex AI Business Assistant from one workspace.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to="/register" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-violet-800 shadow-sm hover:bg-violet-50">Start free for 14 days <span aria-hidden="true">→</span></Link>
                <a href="#features" className="inline-flex items-center rounded-xl border border-white/35 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Explore features</a>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-white/80"><span>✓ No card required</span><span>✓ Demo data clearly labelled</span><span>✓ Hindi &amp; English</span></div>
            </div>
            <div className="relative mx-auto w-full max-w-md">
              <div className="absolute -right-5 -top-5 h-32 w-32 rounded-full bg-fuchsia-300/20 blur-2xl"/>
              <div className="relative rounded-2xl border border-white/20 bg-white p-4 text-slate-900 shadow-2xl sm:p-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3"><div><p className="text-xs font-bold text-violet-700">PLIVEX WORKSPACE</p><p className="mt-1 text-lg font-bold">Invoice overview</p></div><span className="rounded-lg bg-violet-100 px-2 py-1 text-xs font-bold text-violet-700">DEMO</span></div>
                <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-violet-50 p-3"><p className="text-xs text-slate-500">Invoices</p><p className="mt-1 text-xl font-extrabold">42</p><p className="text-[11px] text-slate-500">Sample records</p></div><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-slate-500">Payment status</p><p className="mt-1 text-xl font-extrabold text-emerald-700">Tracked</p><p className="text-[11px] text-slate-500">Demo workflow</p></div></div>
                <div className="mt-4 space-y-3"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><FileText className="h-4 w-4"/></span><div className="flex-1"><p className="text-xs font-bold">Invoices &amp; quotations</p><div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 w-4/5 rounded-full bg-violet-500"/></div></div></div><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><Users className="h-4 w-4"/></span><div className="flex-1"><p className="text-xs font-bold">Clients &amp; leads</p><div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 w-3/5 rounded-full bg-blue-500"/></div></div></div><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Package className="h-4 w-4"/></span><div className="flex-1"><p className="text-xs font-bold">Stock &amp; expenses</p><div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 w-2/3 rounded-full bg-emerald-500"/></div></div></div></div>
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap gap-2 lg:hidden" aria-label="Quick navigation">
          <a href="#features" className="rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-slate-700">Features ↓</a>
          <a href="#about" className="rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-slate-700">About Plivex ↓</a>
          <a href="#pricing" className="rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-slate-700">Pricing ↓</a>
          <a href="#contact" className="rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-slate-700">Contact ↓</a>
        </div>

        <div className="fade-up fade-up-delay-1 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <DemoCard icon={TrendingUp} label="Total Invoiced" value="₹1,94,330" sub="42 invoices" gradient="from-[#6D28D9] to-[#7C3AED]" />
          <DemoCard icon={CheckCircle2} label="Paid" value="₹1,21,900" sub="28 invoices" gradient="from-[#059669] to-[#10B981]" />
          <DemoCard icon={Clock} label="Pending" value="₹72,430" sub="14 invoices" gradient="from-[#D97706] to-[#F59E0B]" />
          <DemoCard icon={Boxes} label="Stock Items" value="128" sub="6 low-stock alerts" gradient="from-[#2563EB] to-[#3B82F6]" />
        </div>

        <div className="fade-up fade-up-delay-2 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><h3 className="text-[13px] font-bold text-slate-900">Sales this week (demo)</h3><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">+18% ↑</span></div>
            <div className="mt-3 h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={TREND}>
                  <defs><linearGradient id="demoSales" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6D28D9" stopOpacity={0.35} /><stop offset="100%" stopColor="#6D28D9" stopOpacity={0.02} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip formatter={(v) => [`₹${Number(v).toLocaleString("en-IN")}`, "Sales"]} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E7EB" }} />
                  <Area type="monotone" dataKey="sales" stroke="#6D28D9" strokeWidth={2} fill="url(#demoSales)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3"><h3 className="text-[13px] font-bold text-slate-900">Recent invoices (demo)</h3><span className="text-[10px] font-semibold text-slate-400">Sample data</span></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[12px]">
                <thead><tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400"><th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Number</th><th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5">Status</th></tr></thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {DEMO_INVOICES.map((it) => (
                    <tr key={it.id}>
                      <td className="px-4 py-3 font-bold text-slate-900">{it.client}</td>
                      <td className="px-4 py-3 font-mono-ui text-slate-500">{it.number}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{it.amount}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${it.status === "Paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{it.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="features" className="scroll-mt-24 fade-up fade-up-delay-3">
          <div className="mb-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#6D28D9]">What you can do</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">Your everyday business tools, in one place</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Explore the key workflows below. Sample figures on this page are demo data, not customer results.</p>
          </div>
          <h3 className="text-[15px] font-bold text-slate-900">Try a module</h3>
          <p className="mt-1 text-[12px] text-slate-500">Tap any module to sign in and land exactly where you wanted to go.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ACTIONS.map((a) => (
              <button key={a.id} onClick={() => requireAuth(a)} className="flex flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white text-left shadow-sm transition-transform hover:-translate-y-0.5">
                <div className={`relative flex h-24 items-center justify-center ${a.gradient}`}><a.icon className="h-9 w-9 text-[#6D28D9]/70" /></div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#6D28D9]/10 text-[#6D28D9]"><a.icon className="h-4 w-4" /></span><h3 className="text-[14px] font-bold text-slate-900">{a.label}</h3></div>
                  <p className="mt-2 flex-1 text-[12px] leading-relaxed text-slate-500">{a.desc}</p>
                  <span className="mt-3 inline-flex items-center gap-1.5 self-start rounded-xl bg-[#6D28D9] px-3.5 py-2 text-[12px] font-bold text-white"><LogIn className="h-3.5 w-3.5" />Sign in to try</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="scroll-mt-24" id="pricing"><PricingSection /></div>
        <div className="scroll-mt-24" id="about"><AboutSection /></div>

        <footer id="contact" className="scroll-mt-24 rounded-3xl border border-[#E5E7EB] bg-white p-6 sm:p-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <div className="flex items-center gap-3"><Logo className="h-10 w-10" rounded="rounded-xl" /><div><p className="text-lg font-bold text-slate-900">Plivex</p><p className="text-sm text-slate-600">Smart Invoicing &amp; Business OS</p></div></div>
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-600">Billing, client records, expenses and business reports for Indian small businesses.</p>
              <p className="mt-3 text-sm font-semibold text-slate-800">Support: <a className="text-[#6D28D9] underline underline-offset-4" href="mailto:support@plivex.in">support@plivex.in</a></p>
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Helpful links &amp; policies</h2>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Link to="/about" className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-violet-50 hover:text-[#6D28D9]">About Plivex</Link>
                <Link to="/pricing" className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-violet-50 hover:text-[#6D28D9]">Plans &amp; Pricing</Link>
                <Link to="/contact-us" className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-violet-50 hover:text-[#6D28D9]">Contact &amp; Support</Link>
                <Link to="/privacy-policy" className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-violet-50 hover:text-[#6D28D9]">Privacy Policy</Link>
                <Link to="/terms-and-conditions" className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-violet-50 hover:text-[#6D28D9]">Terms &amp; Conditions</Link>
                <Link to="/refund-and-cancellation" className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-violet-50 hover:text-[#6D28D9]">Refund &amp; Cancellation</Link>
              </div>
            </div>
          </div>
          <div className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-500">© {new Date().getFullYear()} Plivex. All rights reserved.</div>
        </footer>
      </main>

      <AuthModal open={authAction !== null} actionLabel={authAction} onClose={() => setAuthAction(null)} />
    </div>
  );
}