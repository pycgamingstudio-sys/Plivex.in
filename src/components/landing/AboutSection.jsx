import { Link } from "react-router-dom";
import {
  Receipt, Users, Wallet, BarChart3, ShieldCheck, Plug, Check, Sparkles, Zap, Rocket,
} from "lucide-react";

const PILLARS = [
  {
    icon: Receipt, title: "Smart Billing & Invoicing", tone: "from-[#6D28D9] to-[#7C3AED]",
    features: [
      "GST & Non-GST invoicing", "CGST/SGST/IGST auto-breakup", "WhatsApp one-click sharing",
      "Recurring bills & cycles", "Credit notes & adjustments", "Quotation → invoice convert",
      "HSN autocomplete engine", "Multi-currency invoices", "Print-perfect A4 PDFs", "Dynamic UPI QR codes",
    ],
  },
  {
    icon: Users, title: "Client & Contact Management", tone: "from-[#2563EB] to-[#3B82F6]",
    features: [
      "Isolated client directory", "Per-client ledgers", "Lead pipeline (Kanban)",
      "Client risk assessment", "Self-service client portals", "Auto-fill client details",
      "Contact history timeline", "Duplicate detection",
    ],
  },
  {
    icon: Wallet, title: "Payments & Financial Tracking", tone: "from-[#059669] to-[#10B981]",
    features: [
      "UPI QR code generation", "PayU checkout", "Stripe-ready billing", "Partial payment tracking",
      "Expense & purchase ledger", "Net profit calculation", "Auto payment reminders", "Reconciliation engine",
    ],
  },
  {
    icon: BarChart3, title: "Reports & Business Intelligence", tone: "from-[#D97706] to-[#F59E0B]",
    features: [
      "Revenue reports", "GSTR-1 ready exports", "CSV / Excel downloads", "Tax summary dashboard",
      "P&L statements", "Sales trend charts", "Staff performance metrics", "Inventory valuation",
    ],
  },
  {
    icon: ShieldCheck, title: "AI-First Infrastructure & Security", tone: "from-[#0D9488] to-[#14B8A6]",
    features: [
      "Isolated workspace security", "Role-based access control", "Encrypted cloud backups",
      "99.9% uptime SLA", "Per-tenant data separation", "Audit activity logs", "Secure OTP auth", "Workspace ID isolation",
    ],
  },
  {
    icon: Plug, title: "Usability & Integrations", tone: "from-[#DB2777] to-[#EC4899]",
    features: [
      "Mobile responsive PWA", "Bulk PDF export", "REST API ready", "PayU & Stripe webhooks",
      "Email SMTP integration", "Real-time presence sync", "Multi-user team access", "Custom branding & logos",
    ],
  },
];

const STATS = [
  { value: "50+", label: "Enterprise features" },
  { value: "6", label: "Core pillars" },
  { value: "99.9%", label: "Uptime SLA" },
  { value: "<2 min", label: "First invoice" },
];

export default function AboutSection() {
  return (
    <section id="about" className="fade-up scroll-mt-20">
      <div className="overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="bg-gradient-to-br from-[#6D28D9] to-[#4c1d95] p-6 text-white sm:p-8">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">About Plivex</p></div>
          <h2 className="mt-2 text-[22px] font-bold leading-tight sm:text-[28px]">Ultra-affordable, fast, AI-first B2B SaaS.</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/85">
            Plivex is an all-in-one billing & business operating system built for Indian SMEs, freelancers and agencies.
            We pair enterprise-grade multi-tenant isolation with a blazing-fast interface so you can raise a GST invoice,
            track a payment, and close your books in under two minutes — at a price every business can afford.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-2xl bg-white/10 px-4 py-3 text-center">
                <p className="text-[22px] font-bold leading-none">{s.value}</p>
                <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 sm:p-8">
          <div className="flex items-center gap-2"><Rocket className="h-4 w-4 text-[#6D28D9]" /><h3 className="text-[16px] font-bold text-slate-900">50+ capabilities across 6 core pillars</h3></div>
          <p className="mt-1 text-[12px] text-slate-500">Everything you need to run billing, clients, payments, reports, security and integrations — in one workspace.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.title} className="rounded-2xl border border-[#E5E7EB] bg-slate-50/60 p-4">
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${p.tone} text-white`}><p.icon className="h-4.5 w-4.5" /></span>
                  <h4 className="text-[13px] font-bold text-slate-900">{p.title}</h4>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[11px] font-medium text-slate-600">
                      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-2.5 w-2.5" /></span>{f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-[#6D28D9]/20 bg-[#6D28D9]/5 p-4">
            <Zap className="h-4 w-4 text-[#6D28D9]" />
            <p className="flex-1 text-[12px] font-medium text-slate-700">Every workspace is fully isolated — your invoices, clients and expenses are strictly scoped to your account, never visible to anyone else.</p>
            <Link to="/register" className="rounded-xl bg-[#6D28D9] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#7C3AED]">Start free</Link>
          </div>
        </div>
      </div>
    </section>
  );
}