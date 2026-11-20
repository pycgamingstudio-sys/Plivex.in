import { Link } from "react-router-dom";
import {
  Receipt, Users, Wallet, BarChart3, ShieldCheck, Plug, Check, Sparkles, Zap, Rocket,
} from "lucide-react";

const PILLARS = [
  {
    icon: Receipt, title: "Smart Billing & Invoicing", tone: "from-[#6D28D9] to-[#7C3AED]",
    features: [
      "GST and non-GST invoicing where supported", "Country-aware tax calculation for supported regions", "Invoice sharing through supported channels",
      "Recurring bills & cycles", "Credit notes & adjustments", "Quotation → invoice convert",
      "Product and tax-code assistance where supported", "Workspace currency and locale-aware formatting", "Print-perfect A4 PDFs", "Payment QR options where supported",
    ],
  },
  {
    icon: Users, title: "Client & Contact Management", tone: "from-[#2563EB] to-[#3B82F6]",
    features: [
      "Isolated client directory", "Per-client ledgers", "Lead pipeline (Kanban)",
      "Client and lead organisation", "Client records and contact history", "Auto-fill client details",
      "Contact history timeline", "Duplicate detection",
    ],
  },
  {
    icon: Wallet, title: "Payments & Financial Tracking", tone: "from-[#059669] to-[#10B981]",
    features: [
      "Payment QR options where supported", "Regional payment options where available", "Payment tracking for supported workflows", "Partial payment tracking",
      "Expense and purchase tracking", "Recorded sales and expense summaries", "Payment reminder workflows where supported", "Reconciliation engine",
    ],
  },
  {
    icon: BarChart3, title: "Reports & Business Intelligence", tone: "from-[#D97706] to-[#F59E0B]",
    features: [
      "Revenue and sales reports", "Tax exports where supported", "CSV and spreadsheet exports", "Country-aware tax capability summary",
      "Financial summaries", "Sales trend visualisations", "Team activity insights", "Inventory valuation",
    ],
  },
  {
    icon: ShieldCheck, title: "AI-First Infrastructure & Security", tone: "from-[#0D9488] to-[#14B8A6]",
    features: [
      "Isolated workspace security", "Role-based access control", "Workspace-scoped data access",
      "AI Business Assistant for workspace questions", "Prepare supported records for your confirmation", "Owner-controlled permissions", "Per-tenant data separation", "Audit activity logs", "Secure email login", "Workspace ID isolation",
    ],
  },
  {
    icon: Plug, title: "Usability & Integrations", tone: "from-[#DB2777] to-[#EC4899]",
    features: [
      "Mobile responsive PWA", "Bulk PDF export", "Connected web workspace", "Regional payment options where available",
      "Cancel & track invoices", "Available interface language options", "Workspace team access and role controls", "Custom branding & logos",
    ],
  },
];

const STATS = [
  { value: "6", label: "Core capability areas" },
  { value: "2", label: "Interface language options" },
  { value: "Free", label: "Plan to get started" },
  { value: "No card", label: "Needed to get started" },
];

export default function AboutSection({ showFounderPhotos = true } = {}) {
  return (
    <section id="about" className="plivex-public-section fade-up">
      <div className="overflow-hidden rounded-3xl border border-[#E8E7EF] bg-white shadow-[0_12px_40px_rgba(36,24,72,.06)]">
        <div className="bg-gradient-to-br from-[#6D28D9] to-[#4c1d95] p-6 text-white sm:p-8">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">About Plivex</p></div>
          <h2 className="mt-2 text-[22px] font-bold leading-tight sm:text-[28px]">Smart invoicing with your built-in AI Business Assistant.</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/85">
            Plivex brings invoicing, quotations, customer records, expenses, inventory and business reports together in one web workspace. It is designed for retailers, wholesalers, distributors, freelancers, service providers and small teams that want everyday billing work organised in one place. Tax rules, currency formats and available payment methods are configured for the workspace country. Plivex brings the same connected business workspace to teams wherever they operate.
          </p>
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-3">
            {showFounderPhotos && <img src="/images/yashvant-sharma.webp" alt="Yashvant Sharma, Developer of Plivex" width="56" height="56" loading="lazy" decoding="async" className="h-14 w-14 shrink-0 rounded-full border-2 border-white/70 object-cover object-center" />}
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">Yashvant Sharma</p>
              <p className="text-xs text-white/75">Developer, Plivex</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[.12] px-3 py-3 text-center backdrop-blur-sm sm:px-4">
                <p className="text-[21px] font-bold leading-none tracking-[-0.035em] sm:text-[22px]">{s.value}</p>
                <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 sm:p-8">
          <div className="flex items-center gap-2"><Rocket className="h-4 w-4 text-[#6D28D9]" /><h3 className="text-[16px] font-bold text-slate-900">Business tools in one workspace</h3></div>
          <p className="mt-1 text-[12px] text-slate-500">Explore the main capability areas available in Plivex.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.title} className="plivex-hover-lift rounded-2xl border border-[#E8E7EF] bg-gradient-to-br from-white to-[#FAF9FF] p-4 shadow-[0_1px_2px_rgba(24,24,40,.025)] transition-all">
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

          <div className="mt-8">
            <h3 className="text-[16px] font-bold text-slate-900">Who is Plivex for?</h3>
            <p className="mt-1 text-[12px] text-slate-500">Common business workflows Plivex is designed to support.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#E5E7EB] p-4"><h4 className="text-[13px] font-bold text-slate-900">Retail shops</h4><p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">Prepare customer bills, keep track of stock, and review sales and expenses.</p></div>
              <div className="rounded-2xl border border-[#E5E7EB] p-4"><h4 className="text-[13px] font-bold text-slate-900">Wholesalers &amp; distributors</h4><p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">Create invoices and quotations, manage customer records, and monitor inventory.</p></div>
              <div className="rounded-2xl border border-[#E5E7EB] p-4"><h4 className="text-[13px] font-bold text-slate-900">Freelancers &amp; service providers</h4><p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">Send quotations and invoices, record expenses, and organise client details.</p></div>
              <div className="rounded-2xl border border-[#E5E7EB] p-4"><h4 className="text-[13px] font-bold text-slate-900">Small teams</h4><p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">Use team roles and a shared workspace to organise day-to-day billing work.</p></div>
            </div>
          </div>
          <div className="mt-6 border-t border-[#E5E7EB] pt-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">About the developer</p>
            <div className="mt-3 flex items-center gap-4">
              {showFounderPhotos && <img src="/images/yashvant-sharma.webp" alt="Yashvant Sharma, Developer of Plivex" loading="lazy" width="64" height="64" className="h-16 w-16 shrink-0 rounded-full border border-slate-200 object-cover" />}
              <div className="min-w-0">
                <h3 className="text-[14px] font-bold text-slate-900">Yashvant Sharma</h3>
                <p className="mt-0.5 text-[11px] font-semibold text-[#6D28D9]">Developer, Plivex</p>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-600">Building practical billing and business management tools for businesses and teams.</p>
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-[#6D28D9]/20 bg-[#6D28D9]/5 p-4">
            <Zap className="h-4 w-4 text-[#6D28D9]" />
            <p className="flex-1 text-[12px] font-medium text-slate-700">Workspace records are scoped to the signed-in business account, with role-based access for supported team workflows.</p>
            <Link to="/register" className="rounded-xl bg-[#6D28D9] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#7C3AED]">Start free</Link>
          </div>
        </div>
      </div>
    </section>
  );
}