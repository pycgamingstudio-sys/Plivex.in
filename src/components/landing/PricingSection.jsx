import { Link } from "react-router-dom";
import { Check, Sparkles, Crown, X } from "lucide-react";

const PLANS = [
  {
    id: "basic", name: "Basic", accent: false, badge: null,
    monthly: 199, yearly: 999,
    tagline: "For freelancers & small shops getting started.",
    included: [
      "GST & Non-GST invoicing", "Up to 50 invoices / month", "Dynamic UPI QR codes", "HD PDF downloads",
      "Basic client database", "Expense tracker", "Standard email support", "Zero watermark",
    ],
    locked: ["WhatsApp one-click share", "Custom business logo", "Advanced reports"],
  },
  {
    id: "pro", name: "Pro", accent: true, badge: "MOST POPULAR",
    monthly: 249, yearly: 1599,
    tagline: "For growing businesses that need everything.",
    included: [
      "Unlimited invoices & quotations", "WhatsApp one-click sharing", "Custom branding & logos",
      "Advanced reports & GSTR-1 export", "Full client CRM & lead pipeline", "Multi-currency support",
      "Auto payment reminders", "Priority 24/7 support",
    ],
    locked: [],
  },
];

export default function PricingSection() {
  return (
    <section id="pricing" className="fade-up scroll-mt-20">
      <div className="rounded-3xl border border-[#E5E7EB] bg-white p-5 shadow-sm sm:p-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[#6D28D9]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6D28D9]"><Sparkles className="h-3 w-3" />Pricing</div>
          <h2 className="mt-3 text-[22px] font-bold text-slate-900 sm:text-[26px]">Simple, honest pricing for every business.</h2>
          <p className="mx-auto mt-1.5 max-w-xl text-[12px] text-slate-500">Start free for 14 days with every feature unlocked. No card required. Cancel anytime.</p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div key={plan.id} className={`relative flex flex-col rounded-2xl border p-5 ${plan.accent ? "border-[#6D28D9] bg-[#6D28D9]/5" : "border-[#E5E7EB] bg-white"}`}>
              {plan.badge && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-[#6D28D9] px-3 py-0.5 font-mono-ui text-[9px] font-bold uppercase tracking-wider text-white">{plan.badge}</span>}
              <div className="flex items-center gap-2">
                {plan.accent ? <Crown className="h-4 w-4 text-[#6D28D9]" /> : <Sparkles className="h-4 w-4 text-slate-400" />}
                <p className="text-[14px] font-bold text-slate-900">{plan.name} Plan</p>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{plan.tagline}</p>
              <div className="mt-3 flex items-end gap-1">
                <p className="text-[28px] font-bold leading-none text-slate-900">₹{plan.monthly}</p>
                <span className="mb-0.5 text-[12px] font-medium text-slate-400">/ month</span>
              </div>
              <p className="mt-0.5 text-[11px] font-semibold text-emerald-600">or ₹{plan.yearly.toLocaleString("en-IN")} / year <span className="text-slate-400">(Best Value)</span></p>
              <div className="mt-4 space-y-1.5">
                {plan.included.map((f) => (
                  <div key={f} className="flex items-start gap-2 text-[11px] font-medium text-slate-700"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-2.5 w-2.5" /></span>{f}</div>
                ))}
                {plan.locked.map((f) => (
                  <div key={f} className="flex items-start gap-2 text-[11px] font-medium text-slate-400"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-500"><X className="h-2.5 w-2.5" /></span>{f}</div>
                ))}
              </div>
              <Link to="/register" className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-bold transition-transform hover:-translate-y-0.5 ${plan.accent ? "bg-[#6D28D9] text-white" : "border border-[#6D28D9] text-[#6D28D9] hover:bg-[#6D28D9]/5"}`}>{plan.accent ? <Crown className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}Get {plan.name}</Link>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[10px] text-slate-400">Prices in INR · GST applicable · Secure checkout via PayU</p>
      </div>
    </section>
  );
}