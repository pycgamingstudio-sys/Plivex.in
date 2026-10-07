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
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700 sm:inline">Live demo preview</span>
            <button onClick={() => setAuthAction("")} className="rounded-xl border border-[#E5E7EB] px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50">Sign in</button>
            <Link to="/register" className="rounded-xl bg-[#6D28D9] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#7C3AED]">Get started free</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 pb-16 pt-6 sm:pt-8">
        <div className="fade-up rounded-3xl bg-gradient-to-br from-[#6D28D9] to-[#7C3AED] p-6 text-white shadow-sm sm:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">Welcome to Plivex</p>
          <h1 className="mt-2 text-[24px] font-bold leading-tight sm:text-[30px]">Run your entire billing business from one dashboard.</h1>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-white/85">You're browsing a live demo workspace with sample data — no account needed. Create your workspace to get every feature free for 14 days.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold"><Sparkles className="h-3.5 w-3.5" />14-day full-feature free trial</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold">No card required</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold">Every module unlocked</span>
          </div>
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

        <div className="fade-up fade-up-delay-3">
          <h2 className="text-[15px] font-bold text-slate-900">Try it yourself — one tap away</h2>
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

        <AboutSection />
        <PricingSection />

        <footer className="border-t border-[#E5E7EB] pt-5 text-center">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link to="/privacy-policy" className="text-[11px] font-semibold text-slate-500 hover:text-[#6D28D9]">Privacy Policy</Link>
            <Link to="/terms-and-conditions" className="text-[11px] font-semibold text-slate-500 hover:text-[#6D28D9]">Terms &amp; Conditions</Link>
            <Link to="/refund-and-cancellation" className="text-[11px] font-semibold text-slate-500 hover:text-[#6D28D9]">Refund &amp; Cancellation</Link>
            <Link to="/contact-us" className="text-[11px] font-semibold text-slate-500 hover:text-[#6D28D9]">Contact Us</Link>
          </div>
          <p className="mt-3 text-[10px] text-slate-400">© {new Date().getFullYear()} Plivex · plivex.helps@gmail.com</p>
        </footer>
      </main>

      <AuthModal open={authAction !== null} actionLabel={authAction} onClose={() => setAuthAction(null)} />
    </div>
  );
}